// Signature validation is a format check, not malware scanning.
export function matchesContent(bytes,mime){
 const starts=(...v)=>v.every((n,i)=>bytes[i]===n);
 if(mime==='application/pdf')return starts(37,80,68,70,45);
 if(mime==='image/jpeg')return starts(255,216,255);
 if(mime==='image/png')return starts(137,80,78,71,13,10,26,10);
 if(mime==='image/webp')return starts(82,73,70,70)&&[87,69,66,80].every((n,i)=>bytes[i+8]===n);
 return false;
}
