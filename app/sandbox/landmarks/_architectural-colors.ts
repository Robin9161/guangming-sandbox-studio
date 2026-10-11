/** 建筑日景配色：依据用户材质确认与既有参考图近似取色，非现场色卡测量。
 * 统一银灰金属/蓝灰玻璃的色彩关系，各建筑保留自己的石材色。
 * 无贴图；石材以底色和粗糙度表达，不虚构大理石纹理。
 */
export const architecturalColors = {
 bluewhale: {white:'#e7e5dd',silver:'#bcc8cf',stone:'#d6b365',glass:'#24465f',glazing:'#3c7297',glazingLight:'#668fa9',roof:'#364954',accent:'#285c83'},
 wanda: {white:'#e7e4dc',silver:'#bdc6cb',stone:'#c7b28c',glass:'#293f50',glazing:'#53758c',glazingLight:'#7895a7',roof:'#3b4952',accent:'#a52c2f'},
 cocoCity: {white:'#e5e2da',silver:'#bfc3c4',stone:'#cbbfa9',glass:'#2b414d',glazing:'#506c7b',glazingLight:'#738d97',roof:'#3b484e',accent:'#95664d'},
 nantai: {white:'#e2e3df',silver:'#bfcbd3',stone:'#bdb8a9',glass:'#527a96',green:'#8eaa78',leaf:'#668d69',bronze:'#998970'},
} as const;
