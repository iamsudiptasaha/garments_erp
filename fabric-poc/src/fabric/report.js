// FortuneSheet exports the cell content/borders. Supply omitted backgrounds and page-fit widths.
export function formattedReport(workbook,columns,rowCount){
 const html=workbook?.getHtmlByRange([{row:[0,rowCount],column:[0,columns.length-1]}]);
 if(!html)throw Error('No sheet is available to print.');
 const template=document.createElement('template');template.innerHTML=html;
 const allowed=new Set(['TABLE','THEAD','TBODY','TFOOT','TR','TD','TH','COLGROUP','COL','SPAN','DIV','B','I','U','BR']);
 for(const el of [...template.content.querySelectorAll('*')]){if(!allowed.has(el.tagName)){el.remove();continue}for(const attr of [...el.attributes])if(!['style','rowspan','colspan','width','height','border','cellspacing','cellpadding'].includes(attr.name))el.removeAttribute(attr.name);if(/url\s*\(|expression\s*\(/i.test(el.getAttribute('style')||''))el.removeAttribute('style')}
 const table=template.content.querySelector('table'),sheet=workbook.getSheet();
 if(table){const widths=columns.map((c,i)=>Number(sheet.config?.columnlen?.[i]||c.width)),total=widths.reduce((a,b)=>a+b,0);table.querySelectorAll('colgroup').forEach((col,i)=>{col.removeAttribute('width');col.style.width=`${widths[i]/total*100}%`});
 [...table.rows].forEach((row,r)=>[...row.cells].forEach((cell,c)=>{const source=sheet.data?.[r]?.[c];if(source?.bg&&CSS.supports('background-color',source.bg))cell.style.backgroundColor=source.bg;if(source?.ff)cell.style.fontFamily=source.ff}));const first=table.rows[0];if(first){const head=document.createElement('thead');head.append(first);table.prepend(head)}}
 return template.innerHTML;
}
