import subprocess, sys
from docx import Document
from docx.shared import Pt, RGBColor, Cm
from docx.oxml.ns import qn
from docx.oxml import OxmlElement
out = sys.argv[1]
subprocess.run(['pandoc','-o','/tmp/claude-0/ref-default.docx','--print-default-data-file','reference.docx'],check=True) if False else None
raw = subprocess.run(['pandoc','--print-default-data-file','reference.docx'],capture_output=True,check=True).stdout
open(out,'wb').write(raw)
d = Document(out)
INK=RGBColor(0x14,0x14,0x14); ACC=RGBColor(0xB8,0x86,0x0B); MUTED=RGBColor(0x5D,0x5A,0x52)
def font(st, name, size, bold=None, color=None):
    st.font.name=name; st.font.size=Pt(size)
    rpr=st.element.get_or_add_rPr(); rf=rpr.find(qn('w:rFonts'))
    if rf is None: rf=OxmlElement('w:rFonts'); rpr.append(rf)
    for a in ('w:ascii','w:hAnsi','w:cs','w:eastAsia'): rf.set(qn(a),name)
    if bold is not None: st.font.bold=bold
    if color is not None: st.font.color.rgb=color
S0=d.styles
class _S:
    def __getitem__(self,n):
        for st in S0:
            if st.name==n or st.style_id==n.replace(' ',''): return st
        raise KeyError(n)
    def __iter__(self): return iter(S0)
S=_S()
for n in ('Normal','Body Text','First Paragraph','Compact'):
    if n in [s.name for s in S]:
        font(S[n],'Lato',11,color=INK); S[n].paragraph_format.space_after=Pt(6); S[n].paragraph_format.line_spacing=1.15
font(S['Title'],'Montserrat',30,True,INK)
if 'Subtitle' in [s.name for s in S]: font(S['Subtitle'],'Lato',14,False,MUTED)
font(S['Heading 1'],'Montserrat',22,True,INK); S['Heading 1'].paragraph_format.space_before=Pt(0); S['Heading 1'].paragraph_format.space_after=Pt(12)
font(S['Heading 2'],'Montserrat',17,True,ACC); S['Heading 2'].paragraph_format.space_before=Pt(0); S['Heading 2'].paragraph_format.space_after=Pt(10)
font(S['Heading 3'],'Montserrat',12,True,MUTED); S['Heading 3'].paragraph_format.space_before=Pt(14); S['Heading 3'].paragraph_format.space_after=Pt(6)
for h in ('Heading 1','Heading 2','Heading 3'): S[h].paragraph_format.keep_with_next=True
bt=S['Block Text']; font(bt,'Lato',10.5,False,RGBColor(0x3A,0x34,0x20))
pPr=bt.element.get_or_add_pPr()
shd=OxmlElement('w:shd'); shd.set(qn('w:val'),'clear'); shd.set(qn('w:color'),'auto'); shd.set(qn('w:fill'),'FFF6D9'); pPr.append(shd)
bdr=OxmlElement('w:pBdr'); l=OxmlElement('w:left'); l.set(qn('w:val'),'single'); l.set(qn('w:sz'),'18'); l.set(qn('w:space'),'8'); l.set(qn('w:color'),'B8860B'); bdr.append(l); pPr.append(bdr)
bt.paragraph_format.left_indent=Cm(0.4); bt.paragraph_format.space_before=Pt(4); bt.paragraph_format.space_after=Pt(8)
# table style borders
ts=S['Table']; tblPr=ts.element.find(qn('w:tblPr'))
if tblPr is None: tblPr=OxmlElement('w:tblPr'); ts.element.append(tblPr)
b=OxmlElement('w:tblBorders')
for side in ('top','left','bottom','right','insideH','insideV'):
    e=OxmlElement(f'w:{side}'); e.set(qn('w:val'),'single'); e.set(qn('w:sz'),'4'); e.set(qn('w:color'),'D9D4C7'); b.append(e)
tblPr.append(b)
mar=OxmlElement('w:tblCellMar')
for side in ('top','bottom','left','right'):
    e=OxmlElement(f'w:{side}'); e.set(qn('w:w'),'80' if side in('top','bottom') else '120'); e.set(qn('w:type'),'dxa'); mar.append(e)
tblPr.append(mar)
sec=d.sections[0]; sec.left_margin=sec.right_margin=Cm(2.2); sec.top_margin=sec.bottom_margin=Cm(2)
d.save(out); print('ok')
