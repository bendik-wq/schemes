local first = true
function Header(el)
  if el.level == 2 then
    if first then first = false return el end
    return { pandoc.RawBlock('openxml', '<w:p><w:r><w:br w:type="page"/></w:r></w:p>'), el }
  end
end
