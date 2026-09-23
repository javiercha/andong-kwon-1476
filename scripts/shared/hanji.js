  (function(){
    var root=document.documentElement;
    try{ var c=navigator.connection; if(c&&c.saveData) return; }catch(e){}
    function mkRnd(s){s=(s>>>0)||1;return function(){
      s^=s<<13;s>>>=0;s^=s>>>17;s^=s<<5;s>>>=0;return s/4294967296;};}
    var SIZE=760,N=96;
    function fibre(seed,col,op,w){
      var r=mkRnd(seed),d="",i,x,y,a,L,dx,dy;
      function j(){return r()*18-9;}
      for(i=0;i<N;i++){
        x=r()*SIZE;y=r()*SIZE;a=r()*Math.PI;L=55+r()*120;
        dx=Math.cos(a)*L;dy=Math.sin(a)*L;
        d+="M"+x.toFixed(0)+" "+y.toFixed(0)+"C"+
           (x+dx*0.33+j()).toFixed(0)+" "+(y+dy*0.33+j()).toFixed(0)+" "+
           (x+dx*0.66+j()).toFixed(0)+" "+(y+dy*0.66+j()).toFixed(0)+" "+
           (x+dx).toFixed(0)+" "+(y+dy).toFixed(0);
      }
      return 'url("data:image/svg+xml,'+encodeURIComponent(
        "<svg xmlns='http://www.w3.org/2000/svg' width='"+SIZE+"' height='"+SIZE+
        "' viewBox='0 0 "+SIZE+" "+SIZE+"'><g fill='none' stroke='"+col+
        "' stroke-opacity='"+op+"' stroke-width='"+w+"'><path d='"+d+"'/></g></svg>")+'")';
    }
    var st=document.createElement('style');
    st.textContent='[data-theme="light"]{--tex-fibre:var(--tex-fibre-light)}';
    document.head.appendChild(st);
    var seed=(Date.now()^(Math.random()*4294967296))>>>0;
    root.style.setProperty('--tex-fibre', fibre(seed,'#000000',0.22,0.8));
    root.style.setProperty('--tex-fibre-light', fibre(seed,'#17150F',0.042,0.75));
  })();
