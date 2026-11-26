const S='/tmp/claude-0/-home-claude/0c4b9922-8725-579a-862d-d403bbd31cb4/scratchpad/work/js/';
const M=await import(S+'simplificarPasos.js');
const casos=['x^3-6x^2+11x-6=0','x^3=8','x^3-x=0','x^4-1=0','x^3=0','x^3-3x^2+3x-1=0','2x^3-3x^2-2x=0','x^4-5x^2+4=0','x^3+x^2+x+1=0','x^3-2=0','x^3+2x^2-x-2=0','x^4+4x^2=0','x^5-x=0','x^3-x^2=x-1','x^3/2-x/2=0','x^3-3x+2=0','x^4-3x^2-4=0'];
for(const c of casos){const [l,r]=c.split('=');const o=M.resolverEcuacionPolinomica(l,r);
 console.log('##',c,'=>',o?o.resultado:'null (nerdamer)');
 if(o&&process.argv[2]==='v')o.pasos.forEach(p=>console.log('  ',p.numero,p.descripcion,'|',p.ecuacion));
 if(o){ // verificación numérica independiente (real)
   const f=new Function('x','return '+l.replace(/\^/g,'**').replace(/(\d)([a-z])/g,'$1*$2')+'-('+r.replace(/\^/g,'**')+')');
   for(const t of o.resultado.split(',  ')){const e=t.split(' = ')[1]; if(/i/.test(e))continue; const val=Function('sqrt','return '+e.replace(/\^/g,'**'))(Math.sqrt); if(Math.abs(f(val))>1e-8)console.log('  !!! FALLA',t,f(val));}
 }}
