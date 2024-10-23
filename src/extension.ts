import * as vscode from 'vscode';
import esbuild from 'esbuild';
import path from 'path';
import { polyfillNode } from 'esbuild-plugin-polyfill-node';

export function activate(context: vscode.ExtensionContext) {

	console.log('Congratulations, your extension "hovercomponents" is now active!');

	context.subscriptions.push(
		vscode.languages.registerHoverProvider('*', {
			async provideHover(document, position, token) {
				const range = document.getWordRangeAtPosition(position);
				const word = document.getText(range);

				if (word) {
                    console.log('word: ', word);

                    const reactDocgen = await import('react-docgen');

                    const parsedComponents = reactDocgen.parse(document.getText(), {
                        babelOptions: {
                            parserOpts: {
                                plugins: ['jsx', 'typescript'],
                            },
                        }
                    });

                    console.log('parsedComponents: ', parsedComponents);
					
                    const foundComponent = parsedComponents.find(component => component.displayName === word);

					if (foundComponent) {
						
						const componentName = foundComponent.displayName;
						console.log('componentName: ', componentName);

						const mockProps = generateMockProps(foundComponent);

						const filePath = document.fileName;

						console.log('filePath: ', filePath);

						const outputPath = path.join(__dirname, `preview`, `component.js`);

						await esbuild.build({
							entryPoints: [filePath],
							bundle: true,
							outfile: outputPath,
							format: 'iife',
							platform: 'node',
							globalName: 'ComponentModule',
							target: 'es2022',
							loader: {
								'.webp': 'file',
								'.jpg': 'file',
							},
                            define: {
                                'process.env.NODE_ENV': '"development"', // Inject NODE_ENV
                            },
							plugins: [
                                polyfillNode({
                                    // Options (optional)
                                }),
                                {
                                    name: 'external-modules',
                                    setup(build) {
                                    // Handle React imports
                                    build.onResolve({ filter: /^react$/ }, () => {
                                        return { path: 'react', namespace: 'external-react' };
                                    })
                                    build.onLoad({ filter: /.*/, namespace: 'external-react' }, () => {
                                        return {
                                        contents: 'module.exports = window.React',
                                        loader: 'js'
                                        };
                                    });
                                    
                                    // Handle React DOM imports
                                    //   build.onResolve({ filter: /^react-dom$/ }, () => {
                                    // 	return { path: 'react-dom', namespace: 'external-react-dom' }
                                    //   })
                                    //   build.onLoad({ filter: /.*/, namespace: 'external-react-dom' }, () => {
                                    // 	return {
                                    // 	  contents: 'module.exports = window.ReactDOM',
                                    // 	  loader: 'js'
                                    // 	};
                                    //   });
                                }
							}]
						});

						createWebviewPanel(componentName, outputPath, mockProps);
					}
				}


				return null;
			}
		})
    );
}

function generateMockProps(componentData: any): any {
    const dummyProps: { [key: string]: any } = {};
  
    function generateDummyValue(tsType: any): any {
      switch (tsType.name) {
        case 'string':
          return 'dummy string';
        case 'number':
          return 123;
        case 'boolean':
          return true;
        case 'Array':
          return tsType.elements ? [generateDummyValue(tsType.elements[0])] : [];
        case 'signature':
          if (tsType.type === 'object') {
            const obj: { [key: string]: any } = {};
            tsType.signature.properties.forEach((prop: any) => {
              obj[prop.key] = generateDummyValue(prop.value);
            });
            return obj;
          }
          return {};
        default:
          return null;
      }
    }
  
    Object.keys(componentData.props).forEach((propName) => {
      const propInfo = componentData.props[propName];
      dummyProps[propName] = generateDummyValue(propInfo.tsType);
    });
  
    return dummyProps;
}

// Create a webview panel to display the output
function createWebviewPanel(componentName: any, bundlePath: string, mockProps: any) {
    const panel = vscode.window.createWebviewPanel(
        'functionOutput',
        'Function Output',
        vscode.ViewColumn.Beside,
        {
            enableScripts: true,
        }
    );

	const componentUri = panel.webview.asWebviewUri(vscode.Uri.file(bundlePath));

    // Set the HTML content of the webview
    panel.webview.html = getWebviewContent(componentName, componentUri, mockProps);
}

// Generate HTML content for the webview
function getWebviewContent(componentName: string, componentUri: vscode.Uri, mockProps: any): string {
    return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Function Output</title>
		<script src="https://unpkg.com/react@17/umd/react.development.js"></script>
		<script src="https://unpkg.com/react-dom@17/umd/react-dom.development.js"></script>
		<script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
		<script src="${componentUri}"></script>
        <style>
            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial; padding: 20px; }
            h1 { font-size: 24px; }
            pre { background-color: #f6f8fa; padding: 10px; border-radius: 5px; }
			#app { height: 100vh; background-color: green; color: white; }
        </style>
    </head>
    <body>
        <div id="app"></div>
        <script type="text/babel">
			// Mock props to pass to the component
            const props = ${JSON.stringify(mockProps)};

			console.log('props: ', props);

			const Component = ComponentModule["${componentName}"];

            const App = () => {
                return (
                    <div>
                        <h1>Function Output</h1>
						<Component {...props} />
                    </div>
                );
            };

            ReactDOM.render(React.createElement(App), document.getElementById('app'));
        </script>
    </body>
    </html>`;
}

// This method is called when your extension is deactivated
export function deactivate() {}
