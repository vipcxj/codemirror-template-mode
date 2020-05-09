const rimraf = require('rimraf');
const ts = require('typescript');
const fs = require('fs');
const path = require('path');

rimraf.sync('dist');
fs.mkdirSync('dist');
fs.copyFileSync('src/index.css', 'dist/index.css');

function reportDiagnostics(diagnostics) {
  diagnostics.forEach(diagnostic => {
    let message = 'Error';
    if (diagnostic.file) {
      let { line, character } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
      message += `${diagnostic.file.fileName} (${line + 1},${character + 1})`;
    }
    message += ": " + ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
    console.log(message);
  })
}

function readConfigFile(configFileName) {
  const configFileText = fs.readFileSync(configFileName).toString();
  const result = ts.parseConfigFileTextToJson(configFileName, configFileText);
  const configObject = result.config;
  if (!configObject) {
    reportDiagnostics([result.error]);
    process.exit(1);
  }
  const configParseResult = ts.parseJsonConfigFileContent(configObject, ts.sys, path.dirname(configFileName));
  if (configParseResult.errors.length > 0) {
    reportDiagnostics(configParseResult.errors);
    process.exit(1);
  }
  return configParseResult;
}

function compile(configFileName) {
  const config = readConfigFile(configFileName);
  const program = ts.createProgram(config.fileNames, config.options);
  const emitResult = program.emit();
  reportDiagnostics(ts.getPreEmitDiagnostics(program).concat(emitResult.diagnostics));
  const exitCode = emitResult.emitSkipped ? 1 : 0;
  process.exit(exitCode);
}

compile('tsconfig.json');