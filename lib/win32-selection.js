// EM_GETSEL sorts UTF-16 endpoints. Keep the active caret separate from
// the anchor; native caret geometry disambiguates mouse selection direction.
export function syncNativeSelection(bar,text,start,end,caretAtStart=null,nativeChange=false) {
 const previous=bar.text===text?bar.selectionRange:null;
 const chars=[...text];
 const point=offset=>[...text.slice(0,offset)].length;
 const left=point(start),right=point(end);
 let backward=false;
 if(start!==end){
  // Rendering already sent this exact selection to EDIT. Its asynchronous
  // caret geometry must not reverse the editor's authoritative endpoints.
  if(!nativeChange&&previous&&previous[0]===left&&previous[1]===right)backward=bar.cursor===left;
  else if(caretAtStart!==null)backward=caretAtStart;
  else backward=bar.selectionAnchor===right;
 }
 bar.text=text;
 bar.cursor=Math.min(chars.length,backward?left:right);
 bar.selectionAnchor=start===end?null:backward?right:left;
}

export function nativeSelection(bar) {
 const chars=[...bar.text];
 const offset=index=>chars.slice(0,index).join('').length;
 // EM_SETSEL takes anchor first, active caret second, including backwards.
 return [offset(bar.selectionAnchor??bar.cursor),offset(bar.cursor)];
}
