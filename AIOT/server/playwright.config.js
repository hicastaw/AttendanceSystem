import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'./tests',workers:1,timeout:60000,reporter:'list',
  outputDir:'../../.venv/browser-test-results',use:{viewport:{width:1024,height:600},headless:true}});
