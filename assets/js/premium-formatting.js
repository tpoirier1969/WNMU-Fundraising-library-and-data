(function install(window, document) {
 'use strict';
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const decode=s=>String(s??'').replace(/&(#x[0-9a-f]+|#[0-9]+|amp|lt|gt|quot|apos|nbsp);/gi,(raw,x)=>{
   const named={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '},k=x.toLowerCase();
   if(k in named)return named[k];
   const n=k.startsWith('#x')?parseInt(k.slice(2),16):parseInt(k.slice(1),10);
   return n>0&&n<=0x10ffff&&!(n>=0xd800&&n<=0xdfff)?String.fromCodePoint(n):raw;
 }).replace(/\u00a0/g,' ');
 function plain(s){return decode(String(s??'').replace(/<br\s*\/?>/gi,' ').replace(/<\/?(?:i|em|b|strong)>/gi,'').replace(/\*\*([^*]+)\*\*/g,'$1').replace(/\*([^*]+)\*/g,'$1').replace(/\\\|/g,'|')).replace(/\s+/g,' ').trim();}
 function inline(s){
   const prepared=decode(String(s??'').replace(/<br\s*\/?>/gi,'\u0001').replace(/<\/?(?:i|em)>/gi,'*').replace(/<\/?(?:b|strong)>/gi,'**').replace(/\\\|/g,'|'));
   return esc(prepared).replace(/\*\*([^*\n]+)\*\*/g,'<strong>$1</strong>').replace(/(^|[^*])\*([^*\n]+)\*/g,'$1<em>$2</em>').replace(/\u0001/g,'<br>');
 }
 function pipeCells(line){
   let s=String(line||'').trim();if(s.startsWith('|'))s=s.slice(1);if(s.endsWith('|')&&!s.endsWith('\\|'))s=s.slice(0,-1);
   const cells=[];let part='';
   for(let i=0;i<s.length;i++){if(s[i]==='\\'&&s[i+1]==='|'){part+='\\|';i++;}else if(s[i]==='|'){cells.push(part.trim());part='';}else part+=s[i];}
   cells.push(part.trim());return cells;
 }
 function markdownAt(lines,i){
   if(i+1>=lines.length||!lines[i].includes('|')||!lines[i+1].includes('|'))return null;
   const head=pipeCells(lines[i]),bars=pipeCells(lines[i+1]);
   if(head.length!==bars.length||!bars.every(s=>/^:?-{3,}:?$/.test(s.trim())))return null;
   if(head.length===1)return !plain(head[0])?{next:i+2,block:null}:null;
   let j=i+2;const rows=[];
   while(j<lines.length&&lines[j].includes('|')){
     const row=pipeCells(lines[j]);if(row.length!==head.length)break;
     if(row.some(plain))rows.push(row);j++;
   }
   return rows.length?{next:j,block:{type:'table',header:head,rows}}:null;
 }
 function tabsAt(lines,i){
   if(!lines[i].includes('\t'))return null;
   let j=i;const rows=[];
   while(j<lines.length&&lines[j].includes('\t')){rows.push(lines[j].split('\t').map(s=>s.trim()));j++;}
   const width=rows[0]?.length||0;
   if(rows.length<2||width<2||rows.some(r=>r.length!==width))return null;
   const isHead=rows[0].some(c=>/^(?:premiums?|gift|item|description|sustainer|annual|monthly|donation|level)$/i.test(plain(c)))
     ||(rows[0].every(c=>!/\$\s*\d/.test(c))&&rows.slice(1).some(r=>r.some(c=>/\$\s*\d/.test(c))));
   return {next:j,block:{type:'table',header:isHead?rows.shift():null,rows}};
 }
 function textFromHtml(node){
   if(node.nodeType===3)return node.nodeValue||'';
   if(node.nodeType!==1)return '';
   const tag=node.tagName.toLowerCase();if(tag==='br')return '<br>';
   let s=Array.from(node.childNodes).map(textFromHtml).join('');
   if(tag==='em'||tag==='i')s=`*${s}*`;if(tag==='b'||tag==='strong')s=`**${s}**`;
   if(tag==='p'||tag==='div')s+='<br>';
   return s;
 }
 function htmlTables(raw){
   if(!/<table(?:\s|>)/i.test(raw)||typeof DOMParser==='undefined')return [];
   const doc=new DOMParser().parseFromString(raw,'text/html');
   return Array.from(doc.querySelectorAll('table')).map(table=>{
     const trs=Array.from(table.querySelectorAll('tr')).filter(tr=>tr.closest('table')===table);
     const rows=trs.map(tr=>Array.from(tr.children).filter(td=>/^(?:TD|TH)$/.test(td.tagName))
       .map(td=>textFromHtml(td).replace(/[\t\r\n ]+/g,' ').replace(/(?:<br>\s*)+$/g,'').trim())).filter(r=>r.length>=2);
     if(!rows.length)return null;
     let header=null;
     if(trs[0]&&Array.from(trs[0].children).some(td=>td.tagName==='TH'))header=rows.shift();
     else if(rows.length>1&&rows[0].some(c=>/^(?:premium|sustainer|annual|monthly|item|gift|description)$/i.test(plain(c))))header=rows.shift();
     return {type:'table',header,rows};
   }).filter(x=>x&&x.rows.length);
 }
 function parse(value){
   const raw=String(value??'').replace(/\r\n?/g,'\n').trim();if(!raw)return [];
   const html=htmlTables(raw);if(html.length)return html;
   const lines=raw.split('\n'),blocks=[];
   for(let i=0;i<lines.length;){
     if(!lines[i].trim()){i++;continue;}
     const table=markdownAt(lines,i)||tabsAt(lines,i);
     if(table){if(table.block)blocks.push(table.block);i=table.next;continue;}
     const list=lines[i].match(/^\s*(?:([-*+])\s+|(\d+)[.)]\s+)(.+)$/);
     if(list){const ordered=Boolean(list[2]),items=[];
       while(i<lines.length){const m=lines[i].match(/^\s*(?:([-*+])\s+|(\d+)[.)]\s+)(.+)$/);if(!m||Boolean(m[2])!==ordered)break;items.push(m[3].trim());i++;}
       blocks.push({type:ordered?'ol':'ul',items});continue;
     }
     const paragraphs=[];
     while(i<lines.length&&lines[i].trim()){
       if(paragraphs.length&&(markdownAt(lines,i)||tabsAt(lines,i)||/^\s*(?:[-*+]\s+|\d+[.)]\s+)/.test(lines[i])))break;
       paragraphs.push(lines[i].trim());i++;
     }
     if(paragraphs.length)blocks.push({type:'paragraph',lines:paragraphs});else i++;
   }
   return blocks;
 }
 function blockHtml(block){
   if(block.type==='table'){
     const width=block.header?.length||block.rows[0]?.length||0;
     const head=block.header&&block.header.length===width?`<thead><tr>${block.header.map((c,i)=>`<th scope="col">${inline(!plain(c)&&i===0?'Premium':c)}</th>`).join('')}</tr></thead>`:'';
     const rows=block.rows.map(row=>`<tr>${row.map(c=>`<td${/^\s*(?:\$|USD\s*)\d/i.test(plain(c))?' class="premium-offer-price"':''}>${inline(c)}</td>`).join('')}</tr>`).join('');
     return `<div class="premium-table-wrap"><table class="premium-offer-table">${head}<tbody>${rows}</tbody></table></div>`;
   }
   if(block.type==='ul'||block.type==='ol')return `<${block.type} class="premium-offer-list">${block.items.map(item=>`<li>${inline(item)}</li>`).join('')}</${block.type}>`;
   return `<p class="premium-offer-text">${block.lines.map(inline).join('<br>')}</p>`;
 }
 function fullHtml(value){const b=parse(value);return b.length?`<div class="premium-formatted">${b.map(blockHtml).join('')}</div>`:'';}
 function count(value){return parse(value).reduce((n,b)=>n+(b.type==='table'?b.rows.length:b.type==='paragraph'?1:b.items.length),0);}
 function compact(value){
   const b=parse(value);if(!b.length)return '—';
   const table=b.find(x=>x.type==='table');
   if(table){const n=table.rows.length,money=table.rows.flat().map(plain).find(s=>/^\$\s*\d/.test(s));return `${n} premium ${n===1?'option':'options'}${money?` · from ${money}`:''}`;}
   const first=b[0],t=plain((first.items||first.lines||[])[0]||''),more=count(value)-1;
   return `${t.length>92?t.slice(0,89)+'…':t||'—'}${more>0?` · +${more} more`:''}`;
 }
 function clipboardMarkdown(html){
   if(typeof DOMParser==='undefined')return '';
   const doc=new DOMParser().parseFromString(html,'text/html'),rest=doc.body.cloneNode(true);
   rest.querySelectorAll('table').forEach(t=>t.remove());
   if((rest.textContent||'').trim().length>30)return '';
   return htmlTables(html).map(table=>{
     const width=table.header?.length||table.rows[0]?.length||0;if(!width)return '';
     const header=table.header||Array(width).fill('');
     return [header,Array(width).fill('---'),...table.rows]
       .map(row=>`| ${row.map(c=>String(c).replace(/\|/g,'\\|')).join(' | ')} |`).join('\n');
   }).filter(Boolean).join('\n\n');
 }
 if(document?.addEventListener)document.addEventListener('paste',event=>{
   const target=event.target;if(!target?.matches?.('#detail-edit-form textarea[name="premium_summary"]'))return;
   const html=event.clipboardData?.getData('text/html')||'';
   if(!/<table(?:\s|>)/i.test(html))return;
   const plainText=event.clipboardData?.getData('text/plain')||'';
   if(plainText.includes('\t')||/\|[^\n]*\|\s*\n\s*\|[-:| ]+\|/.test(plainText))return;
   const md=clipboardMarkdown(html);if(!md)return;
   event.preventDefault();
   target.setRangeText(md,target.selectionStart,target.selectionEnd,'end');
   target.dispatchEvent(new Event('input',{bubbles:true}));
 });
 window.PledgePremiumFormatting={parse,fullHtml,count,compact,clipboardMarkdown};
})(window, document);