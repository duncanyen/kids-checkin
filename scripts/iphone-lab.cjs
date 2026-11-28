#!/usr/bin/env node
/** Standalone synthetic device lab. No deploy, cloud project or credentials arguments. */
const {spawn}=require('node:child_process'),path=require('node:path');
const child=spawn(process.execPath,[path.resolve(__dirname,'../tests/iphone-lab/server.cjs'),...process.argv.slice(2)],{stdio:'inherit'});child.on('exit',code=>{process.exitCode=code??1;});child.on('error',e=>{console.error(e.message);process.exitCode=1;});for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>child.kill(signal));
