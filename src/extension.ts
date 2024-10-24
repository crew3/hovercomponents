import * as vscode from 'vscode';
import esbuild from 'esbuild';
import path from 'path';
import fs from 'fs';
import { polyfillNode } from "esbuild-plugin-polyfill-node";


let panel: vscode.WebviewPanel | undefined = undefined;

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
                        },
                        resolver: new reactDocgen.builtinResolvers.FindAllDefinitionsResolver(),
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

                        const nextDir = findNextDir(document.uri.fsPath); // Find the .next directory
                        console.log('nextDir: ', nextDir);

                        let cssFiles: string[] = [];
                        if (nextDir) {
                            const cssFilesPath = path.join(nextDir, 'static', 'chunks');
                            cssFiles = fs.readdirSync(cssFilesPath).filter(file => file.endsWith('.css'));
                            cssFiles.forEach(file => {
                                const fullPath = path.join(cssFilesPath, file);
                                const targetPath = path.join(__dirname, 'preview', 'styles', file);
                                fs.cpSync(fullPath, targetPath, { recursive: true });
                            });
                        }

						await esbuild.build({
							entryPoints: [filePath],
							bundle: true,
							outfile: outputPath,
							format: 'iife',
							platform: 'browser',
							globalName: 'ComponentModule',
							target: 'es2022',
							loader: {
								'.webp': 'file',
								'.jpg': 'file',
							},
                            define: {
                                'process.env.NODE_ENV': '"development"', // Inject NODE_ENV
                                'global': 'globalThis',
                            },
							plugins: [
                                polyfillNode({
                                    polyfills: {
                                        crypto: true,
                                    }
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
                                }
							}]
						});

						createWebviewPanel(componentName, outputPath, nextDir!, cssFiles, mockProps);
					}
				}


				return null;
			}
		})
    );
}

function findNextDir(startPath: string) {
    let currentDir = startPath;

    while (currentDir) {
        const nextDir = path.join(currentDir, '.next');

        // Check if the .next directory exists
        if (fs.existsSync(nextDir) && fs.statSync(nextDir).isDirectory()) {
            return nextDir; // Return the found .next directory
        }

        // Move up one directory
        const parentDir = path.dirname(currentDir);
        // Stop if we've reached the root directory
        if (parentDir === currentDir) {
            break; // Exit if we can't go up anymore
        }
        currentDir = parentDir; // Move up to the parent directory
    }

    return null; // .next directory not found
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
function createWebviewPanel(componentName: any, bundlePath: string, nextDir: string, cssFiles: string[], mockProps: any) {
    if (panel) {
        panel.dispose(); 
    }

    panel = vscode.window.createWebviewPanel(
        'functionOutput',
        'Function Output',
        vscode.ViewColumn.Beside,
        {
            enableScripts: true,
        }
    );

	const componentUri = panel.webview.asWebviewUri(vscode.Uri.file(bundlePath));

    const styleLinkTags = cssFiles.map(cssFile => {
        const cssUri = panel?.webview.asWebviewUri(vscode.Uri.file(path.join(__dirname, 'preview', 'styles', cssFile))); // Convert the path to a URI
        return `<link rel="stylesheet" href="${cssUri}" />`;
    }).join('\n');

    // Set the HTML content of the webview
    panel.webview.html = getWebviewContent(componentName, componentUri, styleLinkTags, mockProps);
}

// Generate HTML content for the webview
function getWebviewContent(componentName: string, componentUri: vscode.Uri, styleLinkTags: string, mockProps: any): string {
    return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Function Output</title>
        ${styleLinkTags}
        <script src="https://unpkg.com/react@17/umd/react.development.js"></script>
		<script src="https://unpkg.com/react@17/umd/react.development.js"></script>
		<script src="https://unpkg.com/react-dom@17/umd/react-dom.development.js"></script>
		<script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
        <script src="https://cdn.tailwindcss.com"></script>
		<script src="${componentUri}"></script>
        <style>
            body { background-color: #0d0d0d; color: #ffffff; margin: 0; padding: 0; }
            h1 { font-size: 24px; }
            pre { background-color: #f6f8fa; padding: 10px; border-radius: 5px; }
			#app { height: 100vh; }
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
                    <div className="h-screen flex flex-col">
                        <div className="font-bold text-lg py-2 px-4">XYZly</div>
                        <div className="rounded-t-2xl border border-black border-opacity-10 bg-white flex-grow px-4 py-4 text-black">
						    <Component {...props} />
                            <div>
                                <pre>
                                    {JSON.stringify(props, null, 2)}
                                </pre>
                            </div>
                        </div>
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
