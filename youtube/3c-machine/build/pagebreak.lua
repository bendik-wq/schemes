local first = true
function Header(el)
  if el.level == 1 then
    if first then first = false return el end
    return { pandoc.RawBlock('openxml', '<w:p><w:r><w:br w:type="page"/></w:r></w:p>'), el }
  end
  if el.level == 2 and el.content and pandoc.utils.stringify(el.content):match('^EP ') then
    return { pandoc.RawBlock('openxml', '<w:p><w:r><w:br w:type="page"/></w:r></w:p>'), el }
  end
end
