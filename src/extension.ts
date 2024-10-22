import * as vscode from 'vscode';
import * as ts from 'typescript';
import { buildReactComponent } from './buildUtils';

export function activate(context: vscode.ExtensionContext) {

	console.log('Congratulations, your extension "hovercomponents" is now active!');

	context.subscriptions.push(
		vscode.languages.registerHoverProvider('*', {
			provideHover(document, position, token) {
				const range = document.getWordRangeAtPosition(position);
				const word = document.getText(range);

				if (word) {
					const functionNode = getFunctionAtPosition(document, position);

					if (functionNode) {
						const { sourceFile, typeChecker } = setupProgram(document);  // Set up the TypeChecker
						const functionCode = getTextForNode(functionNode, document);
						const props = getPropsFromComponent(functionNode, sourceFile!, typeChecker);
						const mockProps = createMockProps(props);
						createWebviewPanel(functionCode, mockProps);
					}
				}


				return null;
			}
		})
    );
}

// Function to create a TypeScript program and get the TypeChecker
function setupProgram(document: vscode.TextDocument) {
	const fileName = 'temp.tsx';
    const compilerOptions: ts.CompilerOptions = {
        target: ts.ScriptTarget.Latest,
        jsx: ts.JsxEmit.React,
        moduleResolution: ts.ModuleResolutionKind.NodeNext,
        noEmit: true,
        esModuleInterop: true,
        skipLibCheck: true,
        strict: true,
    };

    // Create proper virtual file system
    const fileMap = new Map<string, string>();
    fileMap.set(fileName, document.getText());

    // Complete compiler host implementation
    const compilerHost: ts.CompilerHost = {
        getSourceFile: (filename: string, languageVersion: ts.ScriptTarget) => {
            const sourceText = fileMap.get(filename);
            return sourceText 
                ? ts.createSourceFile(filename, sourceText, languageVersion)
                : undefined;
        },
        getDefaultLibFileName: () => "lib.d.ts",
        writeFile: () => {},
        getCurrentDirectory: () => "/",
        getCanonicalFileName: (fileName: string) => fileName,
        useCaseSensitiveFileNames: () => true,
        getNewLine: () => "\n",
        fileExists: (fileName: string) => fileMap.has(fileName),
        readFile: (fileName: string) => fileMap.get(fileName) || "",
        getDirectories: () => [],
    };

    const program = ts.createProgram(
        [fileName], 
        compilerOptions, 
        compilerHost
    );

    return { typeChecker: program.getTypeChecker(), sourceFile: program.getSourceFile(fileName) };
}

function generateMockData(paramType: string): any {
    switch (paramType) {
        case 'string':
            return 'Sample text';
        case 'number':
            return 123;
        case 'boolean':
            return true;
		case 'Array':
		case 'any[]':
            return [1, 2, 3];
        case 'object':
		case '{}':
            return { key: 'value' };
        default:
            return null;
    }
}

// Create dummy props object based on detected parameters
function createMockProps(params: Record<string, string>): Record<string, any> {
    const mockProps: Record<string, any> = {};

    Object.entries(params).forEach(([paramName, paramType]) => {
        mockProps[paramName] = generateMockData(paramType);
    });

    return mockProps;
}

// Extract the single parameter (props object) and parse its fields and types
function getPropsFromComponent(node: ts.Node, sourceFile: ts.SourceFile, typeChecker: ts.TypeChecker): Record<string, string> {
    const props: Record<string, string> = {};

    if (ts.isFunctionDeclaration(node) || ts.isArrowFunction(node)) {
        const [param] = node.parameters;

        // If the parameter has a type (object type for props), we process it
        if (param && param.type) {

			let typeNode = param.type;

			if (ts.isTypeReferenceNode(typeNode)) {
				let typeAlias: ts.TypeAliasDeclaration | undefined;
                
                ts.forEachChild(sourceFile, function findTypeAlias(node) {
					if (ts.isTypeAliasDeclaration(node) && 
					node.name.getText() === (typeNode as ts.TypeReferenceNode).typeName.getText()) {
                        typeAlias = node;
                    }
                });

                if (typeAlias) {
                    typeNode = typeAlias.type;
                }				
			} 
			
			if  (ts.isTypeLiteralNode(typeNode)) {
				typeNode.members.forEach(member => {
                    if (ts.isPropertySignature(member) && member.type) {
                        const propName = member.name.getText();
                        const propType = typeChecker.typeToString(
                            typeChecker.getTypeFromTypeNode(member.type)
                        );
                        props[propName] = propType;
                    }
                });
			}
        }
    }

    return props;
}

// Function to parse the code and find the function node at the current position
function getFunctionAtPosition(document: vscode.TextDocument, position: vscode.Position): ts.FunctionDeclaration | ts.ArrowFunction | null {
    const sourceFile = ts.createSourceFile(
        document.fileName,
        document.getText(),
        ts.ScriptTarget.Latest,
        true
    );

    let functionNode: ts.FunctionDeclaration | ts.ArrowFunction | null = null;

    // Traverse the AST to find the function at the hovered position
    const findFunctionNode = (node: ts.Node) => {
        if (ts.isFunctionDeclaration(node) || ts.isArrowFunction(node)) {
            const { line: startLine, character: startChar } = document.positionAt(node.getStart());
            const { line: endLine, character: endChar } = document.positionAt(node.getEnd());

            // Check if the position is within the function range
            if (position.line >= startLine && position.line <= endLine) {
                functionNode = node as ts.FunctionDeclaration | ts.ArrowFunction;
                return; // Exit traversal if the function is found
            }
        }
        ts.forEachChild(node, findFunctionNode);
    };

    findFunctionNode(sourceFile);

    return functionNode;
}

// Extract the full text of the function node
function getTextForNode(node: ts.Node, document: vscode.TextDocument): string {
    const start = node.getStart();
    const end = node.getEnd();
    const functionCode = document.getText(new vscode.Range(document.positionAt(start), document.positionAt(end)));

    return functionCode;
}

// Create a webview panel to display the output
function createWebviewPanel(component: any, mockProps: any) {
    const panel = vscode.window.createWebviewPanel(
        'functionOutput',
        'Function Output',
        vscode.ViewColumn.Beside,
        {
            enableScripts: true,
        }
    );

    // Set the HTML content of the webview
    panel.webview.html = getWebviewContent(component, mockProps);
}

// Generate HTML content for the webview
function getWebviewContent(component: any, mockProps: any): string {
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
			// Basic React hooks	
			const { useState, useEffect, useRef, useContext } = React;
			
			// Mock props to pass to the component
            const props = ${JSON.stringify(mockProps)};
			
			const Component = ${component}

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
