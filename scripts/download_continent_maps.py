import requests
import os

urls = {
    'asia': 'https://aka.doubaocdn.com/s/DOVR1wqCeq',
    'europe': 'https://aka.doubaocdn.com/s/3Vg01wqCer',
    'africa': 'https://aka.doubaocdn.com/s/2dWl1wqCer',
    'northAmerica': 'https://aka.doubaocdn.com/s/uiI11wqCer',
    'southAmerica': 'https://aka.doubaocdn.com/s/hRSF1wqCer',
    'oceania': 'https://aka.doubaocdn.com/s/GYtz1wqCfV'
}

headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}

os.makedirs('images/gallery/continents', exist_ok=True)

for name, url in urls.items():
    try:
        r = requests.get(url, headers=headers, timeout=30)
        if r.status_code == 200:
            filepath = f'images/gallery/continents/{name}.jpg'
            with open(filepath, 'wb') as f:
                f.write(r.content)
            print(f'Downloaded: {name} -> {filepath} ({len(r.content)} bytes)')
        else:
            print(f'Failed: {name} - Status {r.status_code}')
    except Exception as e:
        print(f'Error downloading {name}: {e}')

print('Done!')
