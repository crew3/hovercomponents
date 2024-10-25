import * as vscode from 'vscode';
import dotenv from 'dotenv';
import esbuild from 'esbuild';
import path from 'path';
import fs from 'fs';
import { polyfillNode } from "esbuild-plugin-polyfill-node";


let panel: vscode.WebviewPanel | undefined = undefined;
let previousComponentName: string | undefined = undefined;
let previousFileContent = '';

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

                        const nextDir = findNextDir(document.uri.fsPath); // Find the .next directory
                        console.log('nextDir: ', nextDir);

                        let cssFiles: string[] = [];
                        if (nextDir) {
                            const cssFilesPath = path.join(nextDir, 'static', 'chunks');

                            if (fs.existsSync(cssFilesPath) && fs.statSync(cssFilesPath).isDirectory()) {
                                cssFiles = fs.readdirSync(cssFilesPath).filter(file => file.endsWith('.css'));
                                cssFiles.forEach(file => {
                                    const fullPath = path.join(cssFilesPath, file);
                                    const targetPath = path.join(__dirname, 'preview', 'styles', file);
                                    fs.cpSync(fullPath, targetPath, { recursive: true });
                                });
                            }
                        }

                        const wrapperFilePath = findWrapperFile(document.uri.fsPath); // Find the wrapper file
                        console.log('wrapperFilePath: ', wrapperFilePath);

                        createWrappedComponentFile(filePath, wrapperFilePath!, componentName!);

                        let envVars: Record<string, unknown> = {};
                        const envFilePath = findEnvFile(document.uri.fsPath); // Find the .env file
                        if (envFilePath) {
                            const envFile = fs.readFileSync(envFilePath, 'utf8');
                            const parsedEnv = dotenv.parse(envFile);
                            
                            Object.keys(parsedEnv).filter(key => key.startsWith('NEXT_PUBLIC')).forEach(key => {
                                envVars[`process.env.${key}`] = `"${parsedEnv[key]}"`;
                            });
                        }

						await esbuild.build({
							entryPoints: [path.join(__dirname, 'wrapped-component.tsx')],
							bundle: true,
							outfile: path.join(__dirname, 'preview', 'component.js'),
							format: 'iife',
							platform: 'browser',
							globalName: 'ComponentModule',
							target: 'es2022',
							loader: {
								'.webp': 'file',
								'.jpg': 'file',
							},
                            define: {
                                ...envVars,
                                'process.env.NODE_ENV': '"development"', // Inject NODE_ENV
                                'global': 'globalThis',
                            },
							plugins: [
                                polyfillNode({
                                    polyfills: {
                                        buffer: false,
                                        crypto: true,
                                        util: true,
                                        stream: false,
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
							}],
                            alias: {
                                // 'stream': 'stream-browserify',
                            },
                            inject: [path.join(__dirname, `polyfill.js`)],
						});
						    
                        createWebviewPanel(componentName, filePath, cssFiles, mockProps);
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

function findEnvFile(startPath: string) {
    let currentDir = startPath;

    // Traverse upwards to find the .env file
    while (currentDir) {
        const envFilePath = path.join(currentDir, '.env');
        if (fs.existsSync(envFilePath)) {
            return envFilePath; // Return the found .env file
        }

        // Move up one directory
        const parentDir = path.dirname(currentDir);
        if (parentDir === currentDir) {
            break; // Stop if we've reached the root directory
        }
        currentDir = parentDir;
    }

    return null; // If no .env file is found
}

function findWrapperFile(startPath: string) {
    let currentDir = startPath;

    while (currentDir) {
        const wrapperFilePath = path.join(currentDir, 'PreviewWrapper.tsx');
        if (fs.existsSync(wrapperFilePath)) {
            return wrapperFilePath; // Return the found wrapper file
        }

        // Move up one directory
        const parentDir = path.dirname(currentDir);
        if (parentDir === currentDir) {
            break; // Stop if we've reached the root directory
        }
        currentDir = parentDir;
    }

    return null;
}

function createWrappedComponentFile(componentFilePath: string, wrapperFilePath: string, componentName: string) {
    const relativeComponentPath = path.relative(__dirname, componentFilePath);

    let wrapperFileImport = '';
    if (wrapperFilePath) {
        const relativeWrapperPath = path.relative(__dirname, wrapperFilePath);
        wrapperFileImport = `import { PreviewWrapper } from './${relativeWrapperPath}';`;
    }

    const file = `
    import * as Module from './${relativeComponentPath}';
    ${wrapperFileImport}

    let ComponentToRender;

    if (Module.${componentName}) {
        // Named export
        ComponentToRender = Module.${componentName};
    } else {
        // Default export
        ComponentToRender = Module.default;
    }

    export default function WrappedComponent(props) {
        return (
            ${wrapperFilePath ? '<PreviewWrapper>' : '<>'}
                <ComponentToRender {...props} />
            ${wrapperFilePath ? '</PreviewWrapper>' : '</>'}
        );
    }
    `;

    fs.writeFileSync(path.join(__dirname, 'wrapped-component.tsx'), file);

    console.log('Creating component file...', file);
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
  
    const hasProps = componentData?.props && Object.keys(componentData.props).length > 0;

    if (hasProps) {
        Object.keys(componentData.props).forEach((propName) => {
        const propInfo = componentData.props[propName];
        dummyProps[propName] = generateDummyValue(propInfo.tsType);
        });
    }
  
    return dummyProps;
}

// Create a webview panel to display the output
function createWebviewPanel(componentName: string, filePath: string, cssFiles: string[], mockProps: any) {
    const currentFileContent = fs.readFileSync(filePath, 'utf-8')
    // display the webview panel only if the component name is different
    // so that when you hover on the component several times it doesn't 
    // unnecessarily update it, which also creates a flicker
    if (previousComponentName === componentName && previousFileContent === currentFileContent) { return false; }
    
    if (panel) {
        panel.dispose();
        previousComponentName = undefined;
    }

    panel = vscode.window.createWebviewPanel(
        'functionOutput',
        'Function Output',
        vscode.ViewColumn.Beside,
        {
            enableScripts: true,
        }
    );

    const componentOutputPath = path.join(__dirname, `preview`, `component.js`);
	const componentUri = panel.webview.asWebviewUri(vscode.Uri.file(componentOutputPath));

    const styleLinkTags = cssFiles.map(cssFile => {
        const cssUri = panel?.webview.asWebviewUri(vscode.Uri.file(path.join(__dirname, 'preview', 'styles', cssFile))); // Convert the path to a URI
        return `<link rel="stylesheet" href="${cssUri}" />`;
    }).join('\n');

    // Set the HTML content of the webview
    panel.webview.html = getWebviewContent(componentName, componentUri, styleLinkTags, mockProps);

    panel.onDidDispose(() => {
        previousComponentName = undefined;
        previousFileContent = '';
        panel = undefined;
    });

    previousComponentName = componentName;
    previousFileContent = currentFileContent;
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
        <script src="https://unpkg.com/react@18/umd/react.development.js"></script>
		<script src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script>
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

            console.log('ComponentModule: ', ComponentModule);

			const Component = ComponentModule["${componentName}"] || ComponentModule.default;

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

            const root = ReactDOM.createRoot(document.getElementById('app'));
            root.render(React.createElement(App));
        </script>
    </body>
    </html>`;
}

// This method is called when your extension is deactivated
export function deactivate() {
    if (panel) {
        panel.dispose();
    }
    panel = undefined;
    previousComponentName = undefined;
    previousFileContent = '';
}