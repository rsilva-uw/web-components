/* React */
import React, { useCallback, useEffect, useState } from 'react';
import { createStore } from 'redux';
import { Provider, connect } from 'react-redux';

/* Accord Project */
import { SlateTransformer } from '@accordproject/markdown-slate';
import { TemplateMarkTransformer } from '@accordproject/markdown-template';
import { Template, Clause, TemplateLibrary, version } from '@accordproject/cicero-core';
import TemplateEditor from '@accordproject/ui-template-editor';
import { getChildren } from '@accordproject/ui-template-editor';

/* Storybook */
import { action } from '@storybook/addon-actions';
import { select, boolean } from '@storybook/addon-knobs';

/* Slate */
import { Editor, Transforms } from 'slate';

/* Misc */
import { uuid } from 'uuidv4';
import styled from 'styled-components';

const slateTransformer = new SlateTransformer();

const ADD_TEMPLATE = 'ADD_TEMPLATE';
const ADD_EDITOR = 'ADD_EDITOR';

const addTemplate = template => ({ type: ADD_TEMPLATE, template });
const addEditor = editor => ({ type: ADD_EDITOR, editor });

const reducer = (state = {}, action) => {
  switch (action.type) {
    case ADD_TEMPLATE:
      console.log('Added these templates to the store: ', action.template);
      return {
        ...state,
        [action.template.metadata.packageJson.name]: action.template
      };
    case ADD_EDITOR:
      console.log('Added editor to the store!');
      return {
        ...state,
        editor: action.editor
      };
    default:
      return state;
  }
};

const store = createStore(reducer);

const Wrapper = styled.div`
  border-radius: 3px;
  border: 1px solid gray;
  margin: 50px;
  padding: 20px;
  width: min-content;
  blockquote {
    width: 80%;
    margin: 10px auto;
    padding: 1.0em 10px 1.2em 15px;
    border-left: 3px solid #484848;
    line-height: 1.5em;
    position: relative;
  }
`;

const markdownText = `# Heading One
This is text. This is *italic* text. This is **bold** text. 
This is a [link](https://clause.io). This is \`inline code\`.
`;

export const templateEditor = () => {
  const lockText = boolean('lockText', true);
  const readOnly = boolean('readOnly', false);
  const [slateValue, setSlateValue] = useState( () => {
    return slateTransformer.fromMarkdown(markdownText).document.children;
  });
  const [editor, setEditor] = useState(null);
  const [templates, setTemplates] = useState([]);
  const templateUrl = select('Insert Template', templates) || "https://templates.accordproject.org/archives/acceptance-of-delivery@0.14.0.cta";  

  useEffect( () => {
    const templateLibrary = new TemplateLibrary();
    templateLibrary.getTemplateIndex( {latestVersion: true, ciceroVersion: version.version} )
    .then( (index) => {
      const temp = {};  
      console.log(index);
      Object.keys(index).forEach(uri => {
        temp[index[uri].displayName] = index[uri].url
      });
      setTemplates(temp);
    });
  }, []);

  useEffect(() => {
    if (editor && templateUrl) {
      Template.fromUrl(templateUrl)
        .then(async (template) => {
          const grammar = template.getParserManager().getTemplate();
          const modelManager = template.getModelManager();
          const t = new TemplateMarkTransformer();
          const templateTokens = t.toTokens({ fileName: 'grammar.txt', content: grammar });
          const type = template.getMetadata().getTemplateType() === 0 ? 'contract' : 'clause';
          const templateMark = t.tokensToMarkdownTemplate(templateTokens, modelManager, type);
          const slateValueNew = slateTransformer.fromTemplateMark(templateMark);
          console.log('slateValueNew', slateValueNew);

          const extraMarkdown = `This is some more text after a clause. Test moving a clause by dragging it or by using the up and down arrows.`;
          const extraText = slateTransformer.fromMarkdown(extraMarkdown);
          const slateClause = [
            {
              children: slateValueNew.document.children,
              data: {
                src: templateUrl,
                name: uuid(),
              },
              object: 'block',
              type: 'clause',
            },
            ...extraText.document.children
          ]
          store.dispatch(addTemplate(template))
          Transforms.insertNodes(editor, slateClause, { at: Editor.end(editor, [])});
        });
    }
  }, [templateUrl, markdownText, editor]);

  const onContractChange = useCallback((value) => {
    setSlateValue(value);
    action('Contract -> Change: ')(value);
  }, [editor]);

  const clausePropsObject = {
    CLAUSE_DELETE_FUNCTION: action('Clause -> Deleted'),
    CLAUSE_EDIT_FUNCTION: action('Clause -> Edit'),
    CLAUSE_TEST_FUNCTION: action('Clause -> Test')
  };

  const augmentEditor = useCallback((slateEditor) => {
    setEditor(slateEditor);
    store.dispatch(addEditor(slateEditor))
    return slateEditor;
  }, []);

  const parseClause = useCallback(async (clauseNode) => {
    if(!clauseNode.data.src) {
      return Promise.resolve(true);
    }
    const SLICE_INDEX_1 = clauseNode.data.src.lastIndexOf('/') + 1;
    const SLICE_INDEX_2 = clauseNode.data.src.indexOf('@');
    const TEMPLATE_NAME = clauseNode.data.src.slice(SLICE_INDEX_1, SLICE_INDEX_2);

    try {
      const newReduxState = store.getState();
      const value = {
        document: {
          children: clauseNode.children
        }
      };
      const text = slateTransformer.toMarkdownCicero(value);
      const ciceroClause = new Clause(newReduxState[TEMPLATE_NAME]);
      ciceroClause.parse(text)
      const parseResult = ciceroClause.getData();
      action('Clause -> Parse: ')({
        clause: TEMPLATE_NAME,
        parseResult,
      });

      const hasFormulas = getChildren(clauseNode, (n) => n.type === 'formula');
      let draftedSlateNode = null;

      if(hasFormulas) {
        const slateDom = await ciceroClause.draft({format:'slate'});
        draftedSlateNode = JSON.parse(JSON.stringify(clauseNode));
        draftedSlateNode.children = slateDom.document.children;
      }

      return Promise.resolve({
        node: hasFormulas ? draftedSlateNode : null,
        operation: hasFormulas ? 'update_formulas' : null,
        error: null,
      });
    } catch (err) {
      action('Clause -> Parse Error: ')({
        clause: TEMPLATE_NAME,
        parseError: err,
        message: err.message
      });
      return Promise.resolve({
        node: null,
        operation: null,
        error: err,
      });
    }

  }, [editor]);

  let timeoutId;
  const debouncedParseClause = node => new Promise((resolve) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout((n) => {
      resolve(parseClause(n));
    }, 500, node);
  });

  return (
    <Wrapper>
      <TemplateEditor
        value={slateValue}
        onChange={onContractChange}
        lockText={lockText}
        readOnly={readOnly}
        clauseProps={clausePropsObject}
        loadTemplateObject={action('Template -> Load')}
        pasteToContract={action('Contract -> Paste')}
        onClauseUpdated={debouncedParseClause}
        augmentEditor={augmentEditor}
      />
    </Wrapper>
  );
};

templateEditor.parameters = {
  notes: "Notes ...."
};


const withProvider = (templateEditor) => <Provider store={store}>{templateEditor()}</Provider>;

export default { title: 'Template Editor', decorators: [withProvider] };
