import glob,re,os,subprocess
files=sorted([f for f in glob.glob('../v2/*-*.md') if not f.endswith('00-front.md')],key=lambda f:int(os.path.basename(f).split('-')[0]))
out=['---','title: "The 3C Machine"','subtitle: "100 scripts · Josh Li"','---','']
words=0
for f in files:
    a=open(f).read()
    act=re.match(r'# (Act \d+ · .+)',a).group(1)
    out+=[f'# {act}','']
    for m in re.finditer(r'^## (EP \d+ · .+?)$(.*?)(?=^## EP |\Z)',a,re.S|re.M):
        title,body=m.groups()
        s=re.search(r'### Script\s*\n(.*?)(?=^### Production|\Z)',body,re.S|re.M)
        body=s.group(1) if s else body
        keep=[]
        for line in body.split('\n'):
            st=line.strip()
            if st.startswith('>') or st.startswith('|') or st.startswith('#'): continue
            if re.fullmatch(r'\*\[.*\]\*',st) or re.fullmatch(r'\[(B-roll|SCREEN|B-ROLL)[^\]]*\]',st,re.I): continue
            jm=re.fullmatch(r'\*\*(\[JOSH:[^\]]*\])\*\*',st)
            if jm: keep.append(jm.group(1)); continue
            if re.fullmatch(r'\*\*[^*]+\*\*',st) and '[JOSH' not in st:
                lab=st.strip('*').strip()
                parts=[p.strip() for p in lab.split('·')]
                if parts and re.fullmatch(r'~?\d+:\d+',parts[-1]): parts=parts[:-1]
                head=parts[0].upper() if parts else ''
                if head in ('HOOK','STAKES','THE FRAME','SOFT CTA','THE NUMBERS','CLOSE','VERDICT','THE VERDICT'): continue
                if head=='WHERE PEOPLE LOSE MONEY': keep.append('Where people lose money.'); continue
                if re.fullmatch(r'\d+',parts[0]): parts=parts[1:]
                if parts: keep.append('**'+'. '.join(p.rstrip('.') for p in parts)+'.**')
                continue
            st=re.sub(r'\*\[B-roll[^\]]*\]\*','',line,flags=re.I)
            keep.append(st.rstrip())
        txt=re.sub(r'\n{3,}','\n\n','\n'.join(keep)).strip()
        words+=len(re.findall(r"[A-Za-z0-9$']+",txt))
        out+=[f'## {title}','',txt,'']
open('pure.md','w').write('\n'.join(out))
subprocess.run(['pandoc','pure.md','-f','markdown-tex_math_dollars-tex_math_single_backslash','-o','The 3C Machine - Scripts.docx','--reference-doc','reference-pure.docx','--lua-filter','pagebreak.lua'],check=True)
print(words,'spoken words')
