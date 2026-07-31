const fs = require('fs');
const filePath = 'c:/Users/Lenovo/Desktop/作业&活动/earth-explorer/earth-explorer/src/earth.html';
const content = fs.readFileSync(filePath, 'utf8');
const firstHtmlEnd = content.indexOf('</html>');
const truncated = content.substring(0, firstHtmlEnd + 7);
fs.writeFileSync(filePath, truncated, 'utf8');
console.log('Done. New size:', truncated.length, 'bytes');
console.log('Lines:', truncated.split('\n').length);
