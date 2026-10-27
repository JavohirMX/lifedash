export function checkSyncUrl(value:string):string|null {
  try {const url=new URL(value.trim());if(!['http:','https:'].includes(url.protocol)||!url.hostname||url.username||url.password||url.hash||url.search)return 'Enter the full server URL starting with http:// or https://, without a username, password, query or fragment.';return null;}catch{return 'Enter the full server URL, for example https://sync.example.com.';}
}
export function syncFailureMessage(error:unknown,action:'login'|'register'|'sync'):string {
 const message=error instanceof Error?error.message:String(error);
 if(message==='Failed to fetch'||/NetworkError|Load failed/i.test(message))return "Couldn't reach the server. Check the Server URL and that the server is running and allows this app to connect, then try again.";
 const status=message.match(/(?:login|register) failed: (\d{3})/);const code=Number(status?.[1]);
 if(code===401)return 'Sign-in was not accepted. Check your username and password, then try again.';
 if(code===403&&action==='register')return 'Account creation is closed on this server. Sign in with the existing account, or check the self-host setup guide.';
 if(code===409&&action==='register')return 'This username is already in use. Sign in, or choose another username.';
 if(code===404)return 'The sign-in endpoint was not found. Check the Server URL and that it points to the Lifedash sync server.';
 if(code===429)return 'Too many attempts. Wait a moment, then try again.';
 if(code>=500)return 'The server could not complete this request. Try again later; your entries are still here.';
 return action==='sync'?'Sync did not finish. Your local data is still here. Check the server and try Sync now again.':'This request did not finish. Check the Server URL and your entries, then try again.';
}
