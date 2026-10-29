import React from 'react';
const h=React.createElement;
export const MIME_OPTIONS=[['application/pdf','PDF'],['image/jpeg','JPEG'],['image/png','PNG'],['image/webp','WebP']];
export function FileTypes({value,onChange,imageOnly=false}){return h('fieldset',{className:'route-file-types'},h('legend',null,'Allowed file types'),MIME_OPTIONS.map(([mime,label])=>h('label',{key:mime},h('input',{type:'checkbox',checked:value.includes(mime),disabled:imageOnly&&mime==='application/pdf',onChange:e=>onChange(e.target.checked?[...value,mime]:value.filter(m=>m!==mime))}),label)))}
