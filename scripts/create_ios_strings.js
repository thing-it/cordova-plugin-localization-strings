var fs = require('fs-extra');
var _ = require('lodash');
var iconv = require('iconv-lite');
var xmldom = require('@xmldom/xmldom');    
var path = require('path');


var iosProjFolder;
var iosPbxProjPath;
var iosPlatformRoot;

var getValue = function(configDoc, name) {
    var nameElement = configDoc.getElementsByTagName(name)[0];
    return nameElement ? nameElement.textContent : null;
}

function jsonToDotStrings(jsonObj){
    var returnString = "";
    _.forEach(jsonObj, function(val, key){
        returnString += '"'+key+'" = "' + val +'";\n';
    });
    return returnString;
}

function initIosDir(context){
    if (!iosProjFolder || !iosPbxProjPath) {
        const projectRoot = context.opts.projectRoot;
        const platformPath = path.join(projectRoot, 'platforms', 'ios');
        // Try to use cordova-ios API (required for Cordova iOS 8.x project naming),
        // but keep a fallback so the hook doesn't hard-crash in environments where it can't be required.
        iosPlatformRoot = platformPath;
        try {
            // In Cordova iOS 8.x, cordova-ios is vendored under platforms/ios/packages/cordova-ios.
            // In older setups it may be available via node resolution.
            let cordova_ios;
            try {
                cordova_ios = require('cordova-ios');
            } catch (e1) {
                try {
                    cordova_ios = require(path.join(platformPath, 'packages', 'cordova-ios'));
                } catch (e2) {
                    try {
                        cordova_ios = require(path.join(platformPath, 'node_modules', 'cordova-ios'));
                    } catch (e3) {
                        throw new Error('Could not find cordova-ios module');
                    }
                }
            }
            const iosProject = new cordova_ios('ios', platformPath);
            iosProjFolder = iosProject.locations.xcodeCordovaProj;
            iosPbxProjPath = iosProject.locations.pbxproj;
            iosPlatformRoot = iosProject.locations.root || platformPath;
            process.stdout.write('[localization-strings] Using cordova-ios API. Platform root: ' + iosPlatformRoot + '\n');
        } catch (e) {
            // Fallback: derive project name from config.xml and assume legacy structure
            console.log('Falling back to config.xml method:', e.message);
            var config = fs.readFileSync(path.join(projectRoot, "config.xml")).toString();
            var configDoc = (new xmldom.DOMParser()).parseFromString(config, 'application/xml');
            var name = getValue(configDoc, "name");
            iosProjFolder = path.join(platformPath, name);
            iosPbxProjPath = path.join(platformPath, name + ".xcodeproj", "project.pbxproj");
            iosPlatformRoot = platformPath;
            process.stdout.write('[localization-strings] Using fallback method. Platform root: ' + iosPlatformRoot + '\n');
        }

    }
}

function getTargetIosDir(context) {
    initIosDir(context);
    return iosProjFolder;
}

function getXcodePbxProjPath(context) {
    initIosDir(context);
    return iosPbxProjPath;
}

function writeStringFile(context, plistStringJsonObj, lang, fileName) {
    try {
        initIosDir(context);
        if (!iosPlatformRoot) {
            throw new Error('iosPlatformRoot is not set');
        }
        // Cordova iOS 8.x template expects *.lproj folders at the platform root (platforms/ios/<lang>.lproj).
        var lProjPath = path.join(iosPlatformRoot, lang + ".lproj");
        fs.ensureDirSync(lProjPath);
        var stringToWrite = jsonToDotStrings(plistStringJsonObj);
        var buffer = iconv.encode(stringToWrite, 'utf8');
        var filePath = path.join(lProjPath, fileName);
        fs.writeFileSync(filePath, buffer);
        process.stdout.write('[localization-strings] Created: ' + filePath + '\n');
    } catch (error) {
        process.stderr.write('[localization-strings] ERROR writing string file for ' + lang + '/' + fileName + ': ' + error.message + '\n');
        process.stderr.write('[localization-strings] iosPlatformRoot: ' + iosPlatformRoot + '\n');
        throw error;
    }
}

function writeLocalisationFieldsToXcodeProj(filePaths, groupname, proj) {
    var fileRefSection = proj.pbxFileReferenceSection();
    var fileRefValues = _.values(fileRefSection);

    if (filePaths.length > 0) {
        var groupKey = proj.findPBXVariantGroupKey({name: groupname});
        if (!groupKey) {
            var localizableStringVarGroup = proj.addLocalizationVariantGroup(groupname);
            groupKey = localizableStringVarGroup.fileRef;
        }

        filePaths.forEach(function (filePath) {
            // filePath is something like "es.lproj/InfoPlist.strings"
            var results = _.find(fileRefValues, function(o){
                return (_.isObject(o) && _.has(o, "path") && o.path.replace(/['"]+/g, '') == filePath);
            });
            if (_.isUndefined(results)) {
                // Not found in pbxFileReference yet, add it relative to the project root
                proj.addResourceFile(filePath, {variantGroup: true}, groupKey);
            }
        });
    }
}
module.exports = function(context) {
    var xcode = require('xcode');
    
    // Log at the very start to ensure we're running
    process.stdout.write('[localization-strings] Hook started\n');

    var localizableStringsPaths = [];
    var infoPlistPaths = [];

    return getTargetLang(context)
        .then(function(languages) {
            process.stdout.write('[localization-strings] Found ' + languages.length + ' translation file(s)\n');
            if (languages.length === 0) {
                process.stdout.write('[localization-strings] WARNING: No translation files found. Files will not be created.\n');
                return Promise.resolve(); // Exit early if no files
            }

            languages.forEach(function(lang){

                //read the json file
                var langJson = require(lang.path);

                // check the locales to write to
                var localeLangs = [];
                if (_.has(langJson, "locale") && _.has(langJson.locale, "ios")) {
                    //iterate the locales to to be iterated.
                    _.forEach(langJson.locale.ios, function(aLocale){
                        localeLangs.push(aLocale);
                    });
                }
                else {
                    // use the default lang from the filename, for example "en" in en.json
                    localeLangs.push(lang.lang);
                }

                _.forEach(localeLangs, function(localeLang){
                    // Always create InfoPlist.strings if iOS locales exist, because Xcode may already
                    // reference these files in the pbxproj and will fail the build if they're missing.
                    var plistString = (_.has(langJson, "config_ios") && !_.isEmpty(langJson.config_ios)) ? langJson.config_ios : {};
                    writeStringFile(context, plistString, localeLang, "InfoPlist.strings");
                    infoPlistPaths.push(localeLang + ".lproj/" + "InfoPlist.strings");

                    //remove APP_NAME and write to Localizable.strings
                    if (_.has(langJson, "app")) {
                        //do processing for appname into plist
                        var localizableStringsJson = langJson.app;
                        
                        //ios specific strings
                        if (_.has(langJson, "app_ios")){
                            Object.assign(localizableStringsJson, langJson.app_ios);
                        }
                        
                        if (!_.isEmpty(localizableStringsJson)) {
                            writeStringFile(context, localizableStringsJson, localeLang, "Localizable.strings");
                            localizableStringsPaths.push(localeLang + ".lproj/" + "Localizable.strings");
                        }
                    }
                });

            });

            var proj = xcode.project(getXcodePbxProjPath(context));
            proj.parseSync();

            writeLocalisationFieldsToXcodeProj(localizableStringsPaths, 'Localizable.strings', proj);
            writeLocalisationFieldsToXcodeProj(infoPlistPaths, 'InfoPlist.strings', proj);

            fs.writeFileSync(getXcodePbxProjPath(context), proj.writeSync());
            console.log('Pbx project written with localization groups [ ' + infoPlistPaths.map(function(p) { return p.split('.')[0]; }).join(', ') + ' ]');

            var platformPath   = path.join( context.opts.projectRoot, "platforms", "ios" );
            var projectFileApi = require( path.join( platformPath, "/cordova/lib/projectFile.js" ) );
            projectFileApi.purgeProjectFileCache( platformPath );
            console.log(platformPath + ' purged from project cache');
        })
        .catch(function(error) {
            process.stderr.write('[localization-strings] ERROR in create_ios_strings hook: ' + error.message + '\n');
            process.stderr.write('[localization-strings] Stack: ' + (error.stack || 'N/A') + '\n');
            throw error;
        });
};


function getTranslationPath (config, name) {
    var value = config.match(new RegExp('name="' + name + '" value="(.*?)"', "i"))

    if(value && value[1]) {
        return value[1];

    } else {
        return null;
    }
}

function getDefaultPath(context){
    var configNodes = context.opts.plugin.pluginInfo._et._root._children;
    var defaultTranslationPath = '';

    for (var node in configNodes) {
        if (configNodes[node].attrib.name == 'TRANSLATION_PATH') {
            defaultTranslationPath = configNodes[node].attrib.default;
        }
    }
    return defaultTranslationPath;
}


function getTargetLang(context) {
    var targetLangArr = [];

    var path = require('path');
    var glob = require('glob');
    var providedTranslationPathPattern;
    var providedTranslationPathRegex;
    var config = fs.readFileSync(path.join(context.opts.projectRoot, "config.xml")).toString();  
    var PATH = getTranslationPath(config, "TRANSLATION_PATH");

    if(PATH == null){
        PATH = getDefaultPath(context);
        providedTranslationPathPattern = PATH + "*.json";
        providedTranslationPathRegex = new RegExp((PATH + "(.*).json"));
    }
    if(PATH != null){
        if(/^\s*$/.test(PATH)){
            providedTranslationPathPattern = getDefaultPath(context);
            providedTranslationPathPattern = PATH + "*.json";
            providedTranslationPathRegex = new RegExp((PATH + "(.*).json"));
        }
        else {
            providedTranslationPathPattern = PATH + "*.json";
            providedTranslationPathRegex = new RegExp((PATH + "(.*).json"));
        }
    }

    return new Promise(function (resolve, reject) {
      // Ensure glob searches from project root
      var absolutePattern = path.isAbsolute(providedTranslationPathPattern) 
        ? providedTranslationPathPattern 
        : path.join(context.opts.projectRoot, providedTranslationPathPattern);
      
      glob(absolutePattern, function(error, langFiles) {
        if (error) {
          reject(error);
          return;
        }
        langFiles.forEach(function(langFile) {
          // langFile from glob is absolute when pattern is absolute
          // Match against the absolute path, but regex expects relative pattern
          var relativePath = path.relative(context.opts.projectRoot, langFile);
          var matches = relativePath.match(providedTranslationPathRegex);
          if (matches) {
            targetLangArr.push({
              lang: matches[1],
              path: langFile
            });
          }
        });
        resolve(targetLangArr);
      });
    });
}

