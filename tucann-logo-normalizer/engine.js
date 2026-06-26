'use strict';
window.TucannEngine = (() => {
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const center=b=>({x:b.x+b.w/2,y:b.y+b.h/2});
  const nextFrame=()=>new Promise(r=>requestAnimationFrame(r));

  async function decode(file){
    try{return await createImageBitmap(file,{imageOrientation:'from-image'});}catch(_){
      const url=URL.createObjectURL(file);
      try{return await new Promise((ok,no)=>{const i=new Image();i.onload=()=>ok(i);i.onerror=()=>no(new Error('Nie udało się odczytać obrazu.'));i.src=url;});}
      finally{setTimeout(()=>URL.revokeObjectURL(url),1000);}
    }
  }

  function sampleBackground(data,w,h,mode,color){
    if(mode==='white') return [255,255,255];
    if(mode==='custom'){
      const n=parseInt(color.slice(1),16);return[(n>>16)&255,(n>>8)&255,n&255];
    }
    const pts=[[2,2],[w-3,2],[2,h-3],[w-3,h-3]];
    const sums=[0,0,0];
    for(const [x,y] of pts){const p=(y*w+x)*4;sums[0]+=data[p];sums[1]+=data[p+1];sums[2]+=data[p+2];}
    return sums.map(v=>Math.round(v/pts.length));
  }

  function removeBackground(ctx,w,h,settings){
    if(settings.backgroundMode==='none') return;
    const img=ctx.getImageData(0,0,w,h),d=img.data;
    const bg=sampleBackground(d,w,h,settings.backgroundMode,settings.customBgColor);
    const tol=10+settings.tolerance*2.3, seen=new Uint8Array(w*h), q=[];
    const similar=i=>{
      if(d[i+3]===0)return true;
      const dr=d[i]-bg[0],dg=d[i+1]-bg[1],db=d[i+2]-bg[2];
      return Math.sqrt(dr*dr+dg*dg+db*db)<=tol;
    };
    const push=(x,y)=>{const k=y*w+x;if(seen[k])return;const p=k*4;if(!similar(p))return;seen[k]=1;q.push(k);};
    for(let x=0;x<w;x++){push(x,0);push(x,h-1);}for(let y=0;y<h;y++){push(0,y);push(w-1,y);}
    for(let n=0;n<q.length;n++){
      const k=q[n],x=k%w,y=(k/w)|0,p=k*4;d[p+3]=0;
      if(x)push(x-1,y);if(x<w-1)push(x+1,y);if(y)push(x,y-1);if(y<h-1)push(x,y+1);
    }
    if(settings.edgeCleanup){
      for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){
        const k=y*w+x,p=k*4;if(d[p+3]===0)continue;
        let empty=0;for(let yy=-1;yy<=1;yy++)for(let xx=-1;xx<=1;xx++)if(d[((y+yy)*w+x+xx)*4+3]===0)empty++;
        if(empty>=3){const dr=d[p]-bg[0],dg=d[p+1]-bg[1],db=d[p+2]-bg[2];const dist=Math.sqrt(dr*dr+dg*dg+db*db);if(dist<tol*1.25)d[p+3]=Math.round(255*clamp((dist-tol*.45)/(tol*.8),0,1));}
      }
    }
    ctx.putImageData(img,0,0);
  }

  function boundsFromAlpha(ctx,w,h){
    const d=ctx.getImageData(0,0,w,h).data;let x1=w,y1=h,x2=-1,y2=-1;
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){if(d[(y*w+x)*4+3]>24){if(x<x1)x1=x;if(x>x2)x2=x;if(y<y1)y1=y;if(y>y2)y2=y;}}
    if(x2<0)throw new Error('Nie wykryto logo po usunięciu tła. Zmniejsz tolerancję.');
    return{x:x1,y:y1,w:x2-x1+1,h:y2-y1+1};
  }

  function largestComponent(ctx,w,h,overall){
    const step=Math.max(1,Math.ceil(Math.max(w,h)/900));
    const sw=Math.ceil(w/step),sh=Math.ceil(h/step),src=ctx.getImageData(0,0,w,h).data;
    const mask=new Uint8Array(sw*sh),seen=new Uint8Array(sw*sh);
    for(let y=0;y<sh;y++)for(let x=0;x<sw;x++)if(src[((Math.min(h-1,y*step)*w)+Math.min(w-1,x*step))*4+3]>50)mask[y*sw+x]=1;
    let best=null;
    for(let i=0;i<mask.length;i++){
      if(!mask[i]||seen[i])continue;
      const q=[i];seen[i]=1;let n=0,x1=sw,y1=sh,x2=0,y2=0;
      for(let z=0;z<q.length;z++){
        const k=q[z],x=k%sw,y=(k/sw)|0;n++;if(x<x1)x1=x;if(x>x2)x2=x;if(y<y1)y1=y;if(y>y2)y2=y;
        const add=j=>{if(j>=0&&j<mask.length&&mask[j]&&!seen[j]){seen[j]=1;q.push(j);}};
        if(x)add(k-1);if(x<sw-1)add(k+1);if(y)add(k-sw);if(y<sh-1)add(k+sw);
      }
      const box={x:x1*step,y:y1*step,w:(x2-x1+1)*step,h:(y2-y1+1)*step,area:n*step*step};
      const isLikelySymbol=box.h>overall.h*.22&&box.w>overall.w*.18;
      if(isLikelySymbol&&(!best||box.area>best.area))best=box;
    }
    return best||overall;
  }

  async function prepare(image,settings){
    const ratio=Math.min(1,settings.maxInputDimension/Math.max(image.width,image.height));
    const c=document.createElement('canvas');c.width=Math.max(1,Math.round(image.width*ratio));c.height=Math.max(1,Math.round(image.height*ratio));
    const ctx=c.getContext('2d',{willReadFrequently:true});ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.drawImage(image,0,0,c.width,c.height);
    removeBackground(ctx,c.width,c.height,settings);await nextFrame();
    const overall=boundsFromAlpha(ctx,c.width,c.height),symbol=largestComponent(ctx,c.width,c.height,overall);
    return{canvas:c,overall,symbol};
  }

  function fitTranslation(box,s,tx,ty,w,h){
    const pad=Math.max(8,Math.min(w,h)*.02),l=box.x*s+tx,t=box.y*s+ty,r=(box.x+box.w)*s+tx,b=(box.y+box.h)*s+ty;
    if(l<pad)tx+=pad-l;if(r>w-pad)tx-=r-(w-pad);if(t<pad)ty+=pad-t;if(b>h-pad)ty-=b-(h-pad);return{tx,ty};
  }
  const trans=(b,s,tx,ty)=>({x:b.x*s+tx,y:b.y*s+ty,w:b.w*s,h:b.h*s});

  function render(prepared,target,settings,isReference){
    const w=settings.width,h=settings.height;let s,tx,ty;
    if(isReference){
      s=Math.min((w*settings.contentScale)/prepared.overall.w,(h*settings.contentScale)/prepared.overall.h);
      const oc=center(prepared.overall);tx=w/2-oc.x*s;ty=h/2-oc.y*s;
    }else if(settings.normalizeMode==='symbol'){
      s=target.symbol.w/prepared.symbol.w;const a=center(prepared.symbol),b=center(target.symbol);tx=b.x-a.x*s;ty=b.y-a.y*s;
    }else{
      s=target.overall.w/prepared.overall.w;const a=center(prepared.overall),b=center(target.overall);tx=b.x-a.x*s;ty=b.y-a.y*s;
    }
    if(settings.keepInside){const max=Math.min((w*.96)/prepared.overall.w,(h*.96)/prepared.overall.h);s=Math.min(s,max);({tx,ty}=fitTranslation(prepared.overall,s,tx,ty,w,h));}
    const over=settings.smoothRaster&&Math.max(w,h)<=2200?2:1;
    const hi=document.createElement('canvas');hi.width=w*over;hi.height=h*over;const hc=hi.getContext('2d');hc.imageSmoothingEnabled=true;hc.imageSmoothingQuality='high';hc.setTransform(s*over,0,0,s*over,tx*over,ty*over);hc.drawImage(prepared.canvas,0,0);
    const out=document.createElement('canvas');out.width=w;out.height=h;const oc=out.getContext('2d');oc.imageSmoothingEnabled=true;oc.imageSmoothingQuality='high';oc.drawImage(hi,0,0,w,h);
    return{canvas:out,overall:trans(prepared.overall,s,tx,ty),symbol:trans(prepared.symbol,s,tx,ty),scale:s};
  }

  function vectorize(canvas,colors){
    const d=canvas.getContext('2d',{willReadFrequently:true}).getImageData(0,0,canvas.width,canvas.height);
    return ImageTracer.imagedataToSVG(d,{ltres:.8,qtres:.8,pathomit:Math.max(8,Math.round(Math.min(canvas.width,canvas.height)/180)),rightangleenhance:true,colorsampling:2,numberofcolors:colors,mincolorratio:.0002,colorquantcycles:3,layering:0,strokewidth:0,linefilter:true,scale:1,roundcoords:2,viewbox:true,desc:false});
  }
  const blob=(canvas,type='image/png')=>new Promise((ok,no)=>canvas.toBlob(b=>b?ok(b):no(new Error('Nie udało się utworzyć pliku.')),type,1));
  function download(data,name,type){const b=data instanceof Blob?data:new Blob([data],{type});const u=URL.createObjectURL(b),a=document.createElement('a');a.href=u;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),2000);}
  return{decode,prepare,render,vectorize,blob,download,nextFrame};
})();
