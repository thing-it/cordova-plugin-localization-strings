const xml = require('cordova-common').xmlHelpers;
const fs = require('fs');
const path = require('path');

const pluginPath = path.resolve(__dirname, './plugin.xml');
const version = process.env.PLUGIN_VERSION;

if (!version) {
    console.log('No plugin version is specified.');

    return;
}

let doc;

try {
    doc = xml.parseElementtreeSync(pluginPath);
} catch (e) {
    console.error('Parsing ' + pluginPath + ' failed');
    throw e;
}

doc.getroot().attrib['version'] = version;
fs.writeFileSync(pluginPath, doc.write({ indent: 4 }), 'utf-8');
