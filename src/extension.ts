import * as vscode from 'vscode';
import dotenv from 'dotenv';
import esbuild from 'esbuild';
import path from 'path';
import fs from 'fs';
import casual from 'casual';
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

                        const cssFiles = findCssFiles(document.uri.fsPath);

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
    return findDirectory(startPath, '.next');
}

function findDistDir(startPath: string) {
    return findDirectory(startPath, 'dist');
}

function findCssFiles(startPath: string) {
    let cssFiles: string[] = [];

    const nextDir = findNextDir(startPath);
    console.log('nextDir: ', nextDir);
    
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

        return cssFiles;
    }

    // For DS, we assume styles.css in dist/ directory
    const distDir = findDistDir(startPath);
    console.log('distDir: ', distDir);

    if (distDir) {
        console.log('dist readdirSync: ', fs.readdirSync(distDir));
        cssFiles = fs.readdirSync(distDir).filter(file => file.endsWith('.css'));
        console.log('cssFiles: ', cssFiles);
        cssFiles.forEach(file => {
            const fullPath = path.join(distDir, file);
            const targetPath = path.join(__dirname, 'preview', 'styles', file);
            fs.cpSync(fullPath, targetPath, { recursive: true });
        });
    }

    return cssFiles;
}

function findDirectory(startPath: string, directoryName: string) {
    let currentDir = startPath;

    while (currentDir) {
        const attemptedDir = path.join(currentDir, directoryName);

        // Check if the directory exists
        if (fs.existsSync(attemptedDir) && fs.statSync(attemptedDir).isDirectory()) {
            return attemptedDir; // Return the found directory
        }

        // Move up one directory
        const parentDir = path.dirname(currentDir);
        // Stop if we've reached the root directory
        if (parentDir === currentDir) {
            break; // Exit if we can't go up anymore
        }
        currentDir = parentDir; // Move up to the parent directory
    }

    return null; // directory not found
}

function findFile(startPath: string, fileName: string) {
    let currentDir = startPath;

    while (currentDir) {
        const filePath = path.join(currentDir, fileName);
        if (fs.existsSync(filePath)) {
            return filePath; // Return the found file
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

function findEnvFile(startPath: string) {
    return findFile(startPath, '.env');
}

function findWrapperFile(startPath: string) {
    return findFile(startPath, 'PreviewWrapper.tsx');
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
            ${wrapperFilePath ? '<PreviewWrapper><ComponentToRender {...props} /></PreviewWrapper>' : '<ComponentToRender {...props} />'}
        );
    }
    `;

    fs.writeFileSync(path.join(__dirname, 'wrapped-component.tsx'), file);

    console.log('Creating component file...', file);
}

function generateFakeString(propName: string): any {
    const lowerCasePropName = propName.toLowerCase();
  
    if (casual[lowerCasePropName]) {
      return casual[lowerCasePropName];
    }
  
    if (lowerCasePropName.includes("name")) {
      return casual.full_name;
    } else if (lowerCasePropName.includes("date")) {
      return casual.date("YYYY-MM-DD");
    } else {
      return casual.words(3);
    }
}

function generateMockProps(componentData: any): any {
    const dummyProps: { [key: string]: any } = {};
  
    function generateDummyValue(propName: string, tsType: any): any {
      switch (tsType.name) {
        case 'string':
          return generateFakeString(propName);
        case 'number':
          return 123;
        case 'boolean':
          return true;
        case 'Array':
          return tsType.elements ? [generateDummyValue(propName, tsType.elements[0])] : [];
        case 'signature':
          if (tsType.type === 'object') {
            const obj: { [key: string]: any } = {};
            tsType.signature.properties.forEach((prop: any) => {
              obj[prop.key] = generateDummyValue(propName, prop.value);
            });
            return obj;
          }
          return {};
        case 'union':
          return tsType.elements.map(e => e.value.replace(/['"]/g, ''));
        default:
          return null;
      }
    }
  
    const hasProps = componentData?.props && Object.keys(componentData.props).length > 0;

    if (hasProps) {
        Object.keys(componentData.props).forEach((propName) => {
        const propInfo = componentData.props[propName];
        dummyProps[propName] = generateDummyValue(propName, propInfo.tsType);
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
                const convertToDefaultProps = (props) => {
                    const defaultProps = {};

                    for (const key in props) {
                        if (typeof props[key] === 'string') {
                            defaultProps[key] = props[key];
                        } else if (Array.isArray(props[key])) {
                            defaultProps[key] = props[key][0];
                        } else if (typeof props[key] === 'object' && props[key] !== null) {
                            defaultProps[key] = convertToDefaultProps(props[key]);
                        }
                    }

                    return defaultProps;
                }

                const [propsState, setPropsState] = React.useState(props);

                const handleInputChange = (propName, value) => {
                    setPropsState((prevProps) => ({ ...prevProps, [propName]: value }));
                };

                function FormField({ name, value, propValue, onChange }) {
                    if (typeof propValue === 'string') {
                        return (
                            <div className="flex flex-col space-y-2">
                                <label className="font-semibold">{name}</label>
                                <input
                                    type="text"
                                    value={value}
                                    onChange={(e) => onChange(name, e.target.value)}
                                    className="p-2 border rounded border-gray-300"
                                />
                            </div>
                        );
                    } else if (Array.isArray(propValue)) {
                        return (
                            <div className="flex flex-col space-y-2">
                                <label className="font-semibold">{name}</label>
                                <select
                                    value={value}
                                    onChange={(e) => onChange(name, e.target.value)}
                                    className="p-2 border rounded border-gray-300"
                                >
                                    {propValue.map((option) => (
                                        <option key={option} value={option}>
                                            {option}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        );
                    }
                    return null;
                }

                return (
                    <div className="h-screen flex flex-col">
                        <div className="font-bold text-lg py-2 px-4">XYZly</div>
                        <div className="rounded-t-2xl border border-black border-opacity-10 bg-white flex-grow p-4 text-black">
						    <Component {...propsState} />
                            <div className="p-4 bg-gray-50 mt-8 rounded space-y-4">
                                {Object.keys(props).map((propName) => (
                                    <FormField
                                        key={propName}
                                        name={propName}
                                        value={propsState[propName]}
                                        propValue={props[propName]}
                                    />
                                ))}
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