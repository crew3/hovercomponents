import { exec } from 'child_process';
import * as util from 'util';

const execPromise = util.promisify(exec);

export async function buildReactComponent(componentName: string): Promise<void> {
    try {
        // Run your bundler command (e.g., Webpack or Vite)
        // Adjust the command based on your setup
        await execPromise(`npm run build:${componentName}`);
        console.log(`Successfully built ${componentName}`);
    } catch (error) {
        console.error(`Error building ${componentName}:`, error);
        throw error;
    }
}