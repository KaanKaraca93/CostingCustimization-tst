# PLM Costing Module API - TST Environment

PLM'deki costing modülü için data manipülasyon ve entegrasyon API'si.

**⚠️ TST (Test) Ortamı - Schema: FSH4**

## Özellikler

- PLM'den gelen XML verilerini parse etme
- ModuleId ve diğer property'leri çıkarma
- JSON formatında response

## Kurulum

```bash
npm install
```

## Kullanım

### Development

```bash
npm run dev
```

### Production

```bash
npm start
```

## API Endpoints

### Health Check
```
GET /health
```

Response:
```json
{
  "status": "OK",
  "message": "PLM Costing API is running",
  "timestamp": "2025-12-14T17:57:43.000Z"
}
```

### Process XML
```
POST /api/costing/process
Content-Type: text/xml
```

Request Body: ProcessWorkflow XML

Response:
```json
{
  "success": true,
  "moduleId": "9457",
  "timestamp": "2025-12-14T17:57:43.000Z"
}
```

## Örnek Kullanım

```bash
curl -X POST http://localhost:3000/api/costing/process \
  -H "Content-Type: text/xml" \
  -d @"Input BOD"
```

## Heroku Deployment

1. Heroku CLI ile login:
```bash
heroku login
```

2. Git remote ekle:
```bash
heroku git:remote -a <app-name>
```

3. Deploy:
```bash
git push heroku master
```

## Environment Variables

- `PORT`: Server port (default: 3000)
- `NODE_ENV`: Environment (development/production)

## Proje Yapısı

```
├── src/
│   ├── index.js           # Ana server dosyası
│   └── utils/
│       └── xmlParser.js   # XML parsing utility'leri
├── .env                   # Environment variables
├── .gitignore
├── package.json
└── README.md
```

## Geliştirme Aşamaları

✅ **Aşama 1**: XML'den ModuleId çıkarma ve JSON response
- [x] Basic Express server kurulumu
- [x] XML parsing
- [x] ModuleId extraction
- [x] JSON API endpoint

🔄 **Sonraki Aşamalar**: (İlerleyen adımlarda geliştirilecek)
- Data manipülasyonu
- PLM Patch API entegrasyonu
- Error handling ve logging
- Validation

## Lisans

ISC

