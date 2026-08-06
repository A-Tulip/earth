import requests
import os

# 搜狐的简明版图片
urls = {
    'asia': 'https://aka.doubaocdn.com/s/hjAZ1wqCIk',
    'europe': 'https://aka.doubaocdn.com/s/V8dP1wqCIk',
    'africa': 'https://aka.doubaocdn.com/s/Q3mO1wqCIk',
    'northAmerica': 'https://aka.doubaocdn.com/s/CY5V1wqCIk',
    'southAmerica': 'https://aka.doubaocdn.com/s/rR2q1wqCIk',
    'oceania': 'https://aka.doubaocdn.com/s/au3m1wqCIk',
    'antarctica': 'https://aka.doubaocdn.com/s/5Ixi1wqCIk'
}

headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}

os.makedirs('images/gallery/continents', exist_ok=True)

for name, url in urls.items():
    try:
        r = requests.get(url, headers=headers, timeout=30)
        if r.status_code == 200:
            filepath = f'images/gallery/continents/{name}-simple.jpg'
            with open(filepath, 'wb') as f:
                f.write(r.content)
            print(f'Downloaded: {name}-simple.jpg ({len(r.content)} bytes)')
        else:
            print(f'Failed: {name} - Status {r.status_code}')
    except Exception as e:
        print(f'Error downloading {name}: {e}')

print('Done!')
