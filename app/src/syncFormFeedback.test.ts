import{describe,it,expect}from'vitest';import{checkSyncUrl,syncFailureMessage}from'./syncFormFeedback';
describe('sync form feedback',()=>{
 it('accepts absolute HTTP selfhost addresses and path prefixes',()=>{for(const url of ['http://localhost:8787','http://192.168.1.10:8787','https://sync.example.com/base/','https://[::1]:8787',' https://sync.example.com '])expect(checkSyncUrl(url)).toBeNull();});
 it('rejects relative, nonHTTP, embedded secrets and ambiguous URL suffixes',()=>{for(const url of ['not-a-url','/sync','javascript:alert(1)','ftp://server','https://name:secret@server','https://server?x=1','https://server#x'])expect(checkSyncUrl(url)).not.toBeNull();});
 it('maps known failures without exposing raw server payloads',()=>{expect(syncFailureMessage(Error('login failed: 401 <private trace>'),'login')).toContain('username and password');expect(syncFailureMessage(Error('register failed: 403 private'),'register')).toContain('Account creation is closed');expect(syncFailureMessage(Error('Failed to fetch'),'login')).toContain('reach the server');expect(syncFailureMessage(Error('unexpected secret'),'sync')).not.toContain('secret');});
});
