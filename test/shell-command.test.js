import {test,expect} from 'bun:test';
import {findShell,shellCommand} from '../lib/shell-command.js';
test('shell resolution prefers /bin/sh and supports Unix, PowerShell and CMD',()=>{
 expect(findShell({exists:()=>true,which:()=>{throw Error('must not search');}})).toEqual({path:'/bin/sh',args:['-c']});
 for(const [name,args] of [['bash',['-c']],['pwsh',['-NoLogo','-NoProfile','-NonInteractive','-Command']],['cmd.exe',['/d','/s','/c']]])
  expect(findShell({exists:()=>false,which:n=>n===name?name:null}).args).toEqual(args);
 expect(()=>findShell({exists:()=>false,which:()=>null})).toThrow('No shell');
});
test('shell command collects output and failure status without terminal controls',async()=>{
 expect(await shellCommand("printf '\\033[31mhello\\033[0m\\nworld'; printf ' error' >&2; exit 7")).toMatch(/hello.*world.*error.*\[exit 7\]/);
 expect(await shellCommand('true')).toBe('(no output)');
});
