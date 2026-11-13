import { readFileSync, writeFileSync } from 'node:fs';
const geometry = readFileSync(new URL('../data/airfoils/dae11.dat',import.meta.url),'utf8').split(/\r?\n/).slice(1).map(line=>line.trim().split(/\s+/).map(Number)).filter(row=>row.length===2&&row.every(Number.isFinite));
const polar = name => readFileSync(new URL('../data/airfoils/'+name,import.meta.url),'utf8').split(/\r?\n/).filter(line=>/^\d/.test(line)).map(line=>line.split(',').map(Number)).filter(row=>row.length===7&&row.every(Number.isFinite)).map(row=>row.slice(0,3));
const ladson = readFileSync(new URL('../data/airfoils/naca0012-ladson.dat',import.meta.url),'utf8').split('zone, t="80 grit"')[1].split('zone,')[0].trim().split(/\r?\n/).map(line=>line.trim().split(/\s+/).map(Number));
// Preserve the measured positive-alpha branch. The zero anchor and negative
// branch are symmetric-model processing, not additional measured points.
const high = [[0,0,0.00809],...ladson.filter(row=>row[0]>0)];
writeFileSync(new URL('../src/airfoil-data.json',import.meta.url),JSON.stringify({dae11:geometry,naca0012:[{re:200000,rows:polar('naca0012-200k.csv')},{re:1000000,rows:polar('naca0012-1m.csv')},{re:6000000,rows:high}]},null,2)+'\n');
