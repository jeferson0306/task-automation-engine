import fs from 'fs-extra';
import path from 'path';
import { logger } from './logger.js';

/**
 * Safely read a file
 */
export async function readFile(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, 'utf-8');
  } catch (error) {
    logger.error(`Failed to read file: ${filePath}`, error);
    throw error;
  }
}

/**
 * Safely write a file
 */
export async function writeFile(filePath: string, content: string): Promise<void> {
  try {
    await fs.ensureDir(path.dirname(filePath));
    await fs.writeFile(filePath, content, 'utf-8');
    logger.info(`File written: ${filePath}`);
  } catch (error) {
    logger.error(`Failed to write file: ${filePath}`, error);
    throw error;
  }
}

/**
 * Safely read JSON file
 */
export async function readJson<T>(filePath: string): Promise<T> {
  try {
    const content = await readFile(filePath);
    return JSON.parse(content);
  } catch (error) {
    logger.error(`Failed to read JSON file: ${filePath}`, error);
    throw error;
  }
}

/**
 * Safely write JSON file
 */
export async function writeJson<T>(filePath: string, data: T, pretty = true): Promise<void> {
  try {
    const content = pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data);
    await writeFile(filePath, content);
  } catch (error) {
    logger.error(`Failed to write JSON file: ${filePath}`, error);
    throw error;
  }
}

/**
 * Check if file exists
 */
export async function fileExists(filePath: string): Promise<boolean> {
  return fs.pathExists(filePath);
}

/**
 * Ensure directory exists
 */
export async function ensureDir(dirPath: string): Promise<void> {
  await fs.ensureDir(dirPath);
}

/**
 * Remove file or directory
 */
export async function remove(filePath: string): Promise<void> {
  try {
    await fs.remove(filePath);
    logger.info(`Removed: ${filePath}`);
  } catch (error) {
    logger.error(`Failed to remove: ${filePath}`, error);
    throw error;
  }
}

/**
 * List files in directory
 */
export async function listFiles(dirPath: string, extension?: string): Promise<string[]> {
  try {
    const files = await fs.readdir(dirPath);
    if (extension) {
      return files.filter(f => f.endsWith(extension));
    }
    return files;
  } catch (error) {
    logger.error(`Failed to list files in: ${dirPath}`, error);
    throw error;
  }
}
