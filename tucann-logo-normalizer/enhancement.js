'use strict';
(function(){
  if(typeof state==='undefined'||typeof ui==='undefined'||!window.TucannEngine)return;
  const grid=document.querySelector('.form-grid'),actions=document.querySelector('.actions');
  const mode=document.getElementById('normalizeMode');
  if(!grid||!actions||!mode)return;

  const opt=document.createElement('option');
  opt.value='symbol-strict';
  opt.textContent='Ptak — identyczna szerokość i wysokość';
  mode.insertBefore(opt,mode.querySelector('option[value="whole"]'));

  grid.insertAdjacentHTML('beforeend',
    '<label class="toggle"><input id="autoVectorize" type="checkbox" checked><span>Wektoryzuj automatycznie po poprawieniu</span></label>'+
    '<label class="toggle"><input id="smoothVector" type="checkbox" checked><span>Wygładź kontury SVG</span></label>'+
    '<label id="vectorSmoothWrap">Siła wygładzania SVG<select id="vectorSmoothing">'+
    '<option value="1">Delikatna — więcej szczegółów</option>'+
    '<option value="2" selected>Standardowa</option>'+
    '<option value="3">Mocna — mniej węzłów</option></select></label>');

  const btn=document.createElement('button');
  btn.id='vectorizeBtn';btn.type='button';btn.className='button secondary';
  btn.style.gridColumn='1/-1';btn.textContent='Wektoryzuj wszystkie SVG';btn.disabled=true;
  actions.appendChild(btn);

  const auto=document.getElementById('autoVectorize');
  const smooth=document.getElementById('smoothVector');
  const strength=document.getElementById('vectorSmoothing');
  const smoothWrap=document.getElementById('vectorSmoothWrap');
  const pref='tucann-vector-v1';

  try{
    const s=JSON.parse(localStorage.getItem(pref)||'{}');
    auto.checked=s.auto!==false;smooth.checked=s.smooth!==false;
    strength.value=s.strength||'2';
    if(s.mode==='symbol-strict')mode.value='symbol-strict';
  }catch(_){}

  function saveExtra(){
    try{localStorage.setItem(pref,JSON.stringify({
      auto:auto.checked,smooth:smooth.checked,strength:strength.value,mode:mode.value
    }));}catch(_){}
  }
  function ready(){return state.items.length&&state.items.every(x=>x.canvas&&!x.error);}
  function refresh(){
    smoothWrap.classList.toggle('hidden',!smooth.checked);
    btn.disabled=state.processing||!ready();
  }
  [auto,smooth,strength,mode].forEach(x=>x.addEventListener('change',()=>{
    if(x===smooth||x===strength)state.items.forEach(i=>i.svg=null);
    saveExtra();refresh();
  }));

  const baseVector=E.vectorize.bind(E);
  E.vectorize=function(canvas,colors){
    if(!smooth.checked||typeof ImageTracer==='undefined')return baseVector(canvas,colors);
    const n=+strength.value||2;
    const p=n===1?{l:.45,q:.45,o:4,r:2}:n===3?{l:1.35,q:1.35,o:18,r:1}:{l:.85,q:.85,o:9,r:2};
    const data=canvas.getContext('2d',{willReadFrequently:true}).getImageData(0,0,canvas.width,canvas.height);
    return ImageTracer.imagedataToSVG(data,{
      ltres:p.l,qtres:p.q,
      pathomit:Math.max(p.o,Math.round(Math.min(canvas.width,canvas.height)/(n===3?125:180))),
      rightangleenhance:true,colorsampling:2,numberofcolors:colors,
      mincolorratio:.0002,colorquantcycles:n===3?4:3,layering:0,
      strokewidth:0,linefilter:true,scale:1,roundcoords:p.r,viewbox:true,desc:false
    });
  };

  const baseRender=E.render.bind(E);
  E.render=function(prepared,target,s,isRef){
    if(isRef||s.normalizeMode!=='symbol-strict')return baseRender(prepared,target,s,isRef);
    const W=s.width,H=s.height,c=b=>({x:b.x+b.w/2,y:b.y+b.h/2});
    const a=c(prepared.symbol),b=c(target.symbol);
    let sx=target.symbol.w/prepared.symbol.w,sy=target.symbol.h/prepared.symbol.h;
    if(s.keepInside){
      const fit=Math.min(1,W*.96/(prepared.overall.w*sx),H*.96/(prepared.overall.h*sy));
      sx*=fit;sy*=fit;
    }
    let tx=b.x-a.x*sx,ty=b.y-a.y*sy;
    const pad=Math.max(8,Math.min(W,H)*.02);
    const l=prepared.overall.x*sx+tx,r=(prepared.overall.x+prepared.overall.w)*sx+tx;
    const t=prepared.overall.y*sy+ty,bt=(prepared.overall.y+prepared.overall.h)*sy+ty;
    if(l<pad)tx+=pad-l;if(r>W-pad)tx-=r-(W-pad);
    if(t<pad)ty+=pad-t;if(bt>H-pad)ty-=bt-(H-pad);
    const over=s.smoothRaster&&Math.max(W,H)<=2200?2:1;
    const hi=document.createElement('canvas');hi.width=W*over;hi.height=H*over;
    const hc=hi.getContext('2d');hc.imageSmoothingEnabled=true;hc.imageSmoothingQuality='high';
    hc.setTransform(sx*over,0,0,sy*over,tx*over,ty*over);hc.drawImage(prepared.canvas,0,0);
    const out=document.createElement('canvas');out.width=W;out.height=H;
    const oc=out.getContext('2d');oc.imageSmoothingEnabled=true;oc.imageSmoothingQuality='high';
    oc.drawImage(hi,0,0,W,H);
    const tr=x=>({x:x.x*sx+tx,y:x.y*sy+ty,w:x.w*sx,h:x.h*sy});
    return{canvas:out,overall:tr(prepared.overall),symbol:tr(prepared.symbol),
      scale:Math.sqrt(sx*sy),scaleX:sx,scaleY:sy};
  };

  async function vectorAll(finalMessage=true){
    if(state.processing||!ready())return;
    state.processing=true;btn.disabled=true;btn.textContent='Wektoryzacja…';
    try{
      let n=0;
      for(const item of state.items){
        status('Wektoryzacja '+(n+1)+'/'+state.items.length+': '+item.name);
        item.svg=E.vectorize(item.canvas,+ui.vectorColors.value||4);
        progress(++n,state.items.length);await E.nextFrame();
      }
      renderList();
      if(finalMessage)status('Gotowe. Wszystkie pliki mają wygładzony PNG i SVG.');
    }catch(e){status('Błąd wektoryzacji: '+e.message,true);}
    finally{
      state.processing=false;btn.textContent='Wektoryzuj wszystkie SVG';
      ui.progressWrap.classList.add('hidden');buttons();refresh();
    }
  }

  btn.onclick=()=>vectorAll(true);
  const original=ui.processBtn.onclick;
  ui.processBtn.onclick=async function(e){
    await original.call(this,e);refresh();
    if(auto.checked&&ready()){
      await vectorAll(false);
      status('Gotowe. Logo poprawione, wygładzone i zwektoryzowane.');
    }
  };
  new MutationObserver(refresh).observe(ui.fileList,{childList:true,subtree:true});
  refresh();
})();