import glob,os,re,subprocess
from docx import Document
from docx.shared import Pt
files=sorted(glob.glob('../v3/*-*.md'),key=lambda f:int(os.path.basename(f).split('-')[0]))
txt='\n\n'.join(open(f).read().strip() for f in files)+'\n'
open('scripts-v3.md','w').write(txt)
d=Document('reference.docx')
for st in d.styles:
    if st.name in ('Normal','Body Text','First Paragraph','Compact'):
        st.font.size=Pt(13); st.paragraph_format.line_spacing=1.5; st.paragraph_format.space_after=Pt(12)
    if st.name=='Heading 2':
        st.font.size=Pt(20); st.paragraph_format.space_after=Pt(18)
d.save('reference-v3.docx')
subprocess.run(['pandoc','scripts-v3.md','-f','markdown-tex_math_dollars-tex_math_single_backslash','-o','The 3C Machine - Scripts.docx','--reference-doc','reference-v3.docx','--lua-filter','pb2.lua'],check=True)
print(len(files),'files',len(re.findall(r'^## ',txt,re.M)),'videos',len(txt),'chars')
