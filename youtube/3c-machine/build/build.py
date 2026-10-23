import glob,re,subprocess,os
V2='../v2'
files=sorted([f for f in glob.glob(f'{V2}/*-*.md') if not f.endswith('00-front.md')],key=lambda f:int(os.path.basename(f).split('-')[0]))
front=open(f'{V2}/00-front.md').read()
acts=[open(f).read().strip() for f in files]
seasons={1:'Season 1 · The model (episodes 01–40)',9:'Season 2 · Own it, grow it (episodes 41–70)',15:'Season 3 · Exit, playbooks and deal breakdowns (episodes 71–100)'}
# series map
smap=['# The 100 episodes','']
for a in acts:
    m=re.match(r'# (Act \d+ · .+)',a); title=m.group(1) if m else '?'
    n=int(re.search(r'Act (\d+)',title).group(1))
    if n in seasons: smap+=[f'**{seasons[n]}**','']
    tbl=re.search(r'(\| *EP *\|.*?\n(?:\|.*\n)+)',a)
    smap+=[f'*{title}*','',tbl.group(1).strip() if tbl else '','']
# appendix
app=['# Appendix · Josh\'s interview sheet','','Every fact only Josh can supply, by episode. One or two sentences each is enough; anything marked optional can be cut.','']
count=0
for a in acts:
    for m in re.finditer(r'^## (EP \d+ · .+?)$(.*?)(?=^## EP |\Z)',a,re.S|re.M):
        ps=[]
        for p in re.findall(r'\[JOSH:\s*([^\]]+)\]',m.group(2)):
            p=' '.join(p.split()).rstrip('*')
            if p not in ps: ps.append(p)
        if ps:
            app+=[f'**{m.group(1)}**','']+[f'- [ ] {p}' for p in ps]+['']; count+=len(ps)
app.insert(3,f'**{count} questions.**\n')
body=[]
for a in acts:
    n=int(re.search(r'^# Act (\d+)',a,re.M).group(1))
    body.append(a)
import unicodedata
def slug(t):
    t=t.lower(); t=re.sub(r'[^\w\s-]','',t); return re.sub(r'\s+','-',t.strip())
toc=['# Contents','']
for a in acts:
    m=re.match(r'# (Act \d+ · .+)',a); t=m.group(1)
    n=int(re.search(r'Act (\d+)',t).group(1))
    if n in seasons: toc+=['',f'**{seasons[n]}**','']
    eps=re.findall(r'^## (EP \d+) · ',a,re.M)
    toc.append(f'- [{t}](#{slug(t)}) · {eps[0][3:]}–{eps[-1][3:]}')
toc+=['',"- [The 100 episodes](#the-100-episodes)","- [Appendix · Josh's interview sheet](#appendix-joshs-interview-sheet)"]
front2=front.replace('# How to use this document','\n'.join(toc)+'\n\n# How to use this document',1)
allmd=front2+'\n\n'+'\n'.join(smap)+'\n\n'+'\n\n'.join(body)+'\n\n'+'\n'.join(app)+'\n'
open('the-3c-machine.md','w').write(allmd)
subprocess.run(['pandoc','the-3c-machine.md','-f','gfm-tex_math_dollars+yaml_metadata_block' if False else 'markdown-tex_math_dollars-tex_math_single_backslash+pipe_tables+task_lists','-o','The 3C Machine.docx','--reference-doc','reference.docx','--lua-filter','pagebreak.lua','-M','toc-title=Contents'],check=True)
print(len(files),'acts',len(allmd),'chars',count,'josh prompts')
