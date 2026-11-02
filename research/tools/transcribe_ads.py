import json,os,sys,subprocess
import numpy as np
from faster_whisper import WhisperModel
m=WhisperModel(sys.argv[1] if len(sys.argv)>1 else 'small.en',device='cpu',compute_type='int8',cpu_threads=4)
out=json.load(open('tx.json')) if os.path.exists('tx.json') else {}
ids=[l.split()[0] for l in open('durations.txt')]
seen=set()
for l in open('durations.txt'):
  i,d,h=l.split()
  if h in seen or i in out: seen.add(h); continue
  seen.add(h)
  raw=subprocess.run(['ffmpeg','-v','error','-i',f'dl/{i}.mp4','-ac','1','-ar','16000','-f','s16le','-'],capture_output=True).stdout
  audio=np.frombuffer(raw,np.int16).astype(np.float32)/32768.0
  segs,info=m.transcribe(audio,beam_size=5,vad_filter=True)
  out[i]={'dur':int(d),'segments':[(round(s.start,1),s.text.strip()) for s in segs]}
  json.dump(out,open('tx.json','w'),indent=1); print(i,len(out[i]['segments']),flush=True)
