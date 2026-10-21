import sharp from "sharp";
const dir = "D:/workspace/MMD project/tmp/k3-shots";
for (const name of ["koleda-k3-before", "koleda-classic-before"]) {
  const { data, info } = await sharp(`${dir}/${name}.png`).raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  let minX=width, maxX=0, minY=height, maxY=0, count=0;
  for (let y=0; y<height; y+=2) for (let x=0; x<width; x+=2) {
    const i=(y*width+x)*channels;
    const r=data[i], g=data[i+1], b=data[i+2];
    if (!(r>245&&g>245&&b>245)) { if(x<minX)minX=x; if(x>maxX)maxX=x; if(y<minY)minY=y; if(y>maxY)maxY=y; count++; }
  }
  console.log(name, "bbox:", minX, minY, maxX, maxY, "samples:", count, "size:", width, height);
}
