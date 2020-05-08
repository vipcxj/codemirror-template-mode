import * as CodeMirror from 'codemirror';
import 'codemirror/lib/codemirror.css';
import 'codemirror/mode/sql/sql';
import 'codemirror/mode/groovy/groovy';
import 'codemirror/addon/edit/closebrackets';
import 'codemirror/addon/edit/closetag';
import 'codemirror/addon/fold/foldcode';
import 'codemirror/addon/fold/foldgutter';
import 'codemirror/addon/fold/foldgutter.css';
import 'codemirror/addon/fold/comment-fold';
import 'codemirror/addon/fold/brace-fold';
import '../src';
import '../src/index.css'
import { ITemplateOptions } from '../src';

function registerTrigger(onPageInit?: () => void, onPageChange?: () => void) {
  document.addEventListener('DOMContentLoaded', function() {
    onPageInit && onPageInit();
    const callback = function(mutationsList) {
      for (let i = 0, len = mutationsList.length; i < len; i++) {
        if (mutationsList[i].type == 'childList') {
          onPageChange && onPageChange();
          break;
        }
      }
    };

    const observer = new MutationObserver(callback);
    const config = { childList: true, subtree: false };
    observer.observe(document.getElementById('root')!, config);
  }, false);
}

export default {
  title: 'Demo',
};

type OptionsType = {
  [name: string]: CodeMirror.EditorConfiguration & {
    mode: ITemplateOptions,
    content: string
  },
}

const CONTENT = `
select f.id, f.name 
from Family f
where
#[if][#{domainInfo.type == "root"}][
1 = 1
][#{domainInfo.type == "district"}][
f.base.project.district = #{:domain}
][#{domainInfo.type == "project"}][
f.base.project = #{:domain}
][#{domainInfo.type == "base"}][
f.base = #{:domain}
][
1 = 0
]
`;

const Options: OptionsType = {
  base: {
    mode: {
      name: 'cxj-template' as 'cxj-template',
      mode: 'sql',
      codeMode: 'groovy',
    },
    lineNumbers: true,
    autoCloseBrackets: true,
    autoCloseTags: true,
    foldGutter: true,
    gutters: ["CodeMirror-linenumbers", "CodeMirror-foldgutter"],
    content: CONTENT,
  },
};

// noinspection JSUnusedGlobalSymbols
export const XmlMixedMode = () => {
  const textAreaElement = document.createElement('textarea');
  textAreaElement.id = 'codemirror-base';
  return textAreaElement;
};

registerTrigger(undefined, () => {
  for (const name of Object.keys(Options)) {
    const { content, ...option } = Options[name];
    const textArea: HTMLTextAreaElement = document.getElementById(`codemirror-${name}`) as HTMLTextAreaElement;
    if (textArea && textArea.style.display !== 'none') {
      const cm = CodeMirror.fromTextArea(textArea, option);
      cm.setValue(content);
      for (let i = 0; i < cm.lineCount(); ++ i) {
        cm.indentLine(i);
      }
    }
  }
});
