"""Exercise real loopback HTTP header refusals before the browser runs."""
import http.client
import json

def request(method,path,headers,body=b''):
 c=http.client.HTTPConnection('127.0.0.1',4178,timeout=5)
 try:
  c.putrequest(method,path,skip_host=True,skip_accept_encoding=True)
  for key,value in headers:
   c.putheader(key,value)
  c.putheader('Content-Length',str(len(body)))
  c.endheaders(body)
  response=c.getresponse()
  return response.status,response.read()
 finally:
  c.close()

def main():
 host=[('Host','127.0.0.1:4178')]
 status,data=request('GET','/state',host)
 assert status==200
 initial=json.loads(data)
 body=json.dumps({'actor':'material','kind':'read','table':'products','id':initial['products'][0]['id']}).encode()
 valid=host+[('Origin','http://127.0.0.1:4177'),('Content-Type','application/json')]
 assert request('POST','/call',valid,body)[0]==200
 mutants=[
  [('Host','evil.test:4178')]+valid[1:],
  valid[1:],
  host+[('Origin','https://evil.test'),valid[2]],
  host+[('Origin','null'),valid[2]],
  host+[valid[2]],
  valid[:2]+[('Content-Type','text/plain')],
  valid[:2],
  valid[:2]+[('Content-Type','application/json; charset=utf-8')],
  valid+[('Host','evil.test')],
  valid+[('Origin','https://evil.test')],
  valid+[('Content-Type','text/plain')],
  valid+[('Sec-Fetch-Site','cross-site')],
 ]
 for headers in mutants:
  assert request('POST','/call',headers,body)[0]==403, 'HTTP_HEADER_FALSE_GREEN'
 # DNS rebinding reads and hostile Origin reads must also fail.
 assert request('GET','/state',[('Host','evil.test:4178')])[0]==403
 assert request('GET','/state',host+[('Origin','https://evil.test')])[0]==403
 status,data=request('GET','/state',host)
 assert status==200 and json.loads(data)==initial, 'HTTP_REFUSAL_STATE_DRIFT'
 print('QC_MATERIAL_HTTP_CONTROLS_PASS refusals=14 positive=2')

if __name__=='__main__':
 main()
