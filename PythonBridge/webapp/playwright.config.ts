import {defineConfig} from '@playwright/test';
const port=process.env.WORKBENCH_TEST_PORT||'5183';
export default defineConfig({testDir:'./tests',workers:1,use:{baseURL:'http://127.0.0.1:'+port+'/workbench/',channel:'chrome',headless:true,viewport:{width:1440,height:1000}},webServer:{command:'npm.cmd run dev -- --port '+port+' --strictPort',url:'http://127.0.0.1:'+port+'/workbench/',reuseExistingServer:false},reporter:'list'});
