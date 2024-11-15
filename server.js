// server.js
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const session = require('express-session');

const app = express();
const db = new sqlite3.Database('./database.db');

// Настройка middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: 'your_secret_key', // Замените на свой секретный ключ
  resave: false,
  saveUninitialized: false, // Изменено на false для корректной работы сессий
  cookie: { secure: false } // Для разработки. В продакшене должно быть true
}));

// Создание таблиц базы данных, если они не существуют
db.serialize(() => {
  // Таблица водителей
  db.run(`CREATE TABLE IF NOT EXISTS drivers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    phone TEXT UNIQUE,
    password TEXT,
    earnings REAL DEFAULT 0
  )`);

  // Таблица бизнесов
  db.run(`CREATE TABLE IF NOT EXISTS businesses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_name TEXT UNIQUE,
    contact_info TEXT,
    password TEXT
  )`);

  // Таблица кампаний
  db.run(`CREATE TABLE IF NOT EXISTS campaigns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER,
    title TEXT,
    budget REAL,
    status TEXT DEFAULT 'active',
    FOREIGN KEY (business_id) REFERENCES businesses(id)
  )`);

  // Таблица маршрутов
  db.run(`CREATE TABLE IF NOT EXISTS routes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    driver_id INTEGER,
    campaign_id INTEGER,
    distance REAL,
    earnings REAL,
    date TEXT,
    FOREIGN KEY (driver_id) REFERENCES drivers(id),
    FOREIGN KEY (campaign_id) REFERENCES campaigns(id)
  )`);

  // Таблица заявок на участие в кампаниях
  db.run(`CREATE TABLE IF NOT EXISTS applications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    driver_id INTEGER,
    campaign_id INTEGER,
    status TEXT DEFAULT 'pending',
    FOREIGN KEY (driver_id) REFERENCES drivers(id),
    FOREIGN KEY (campaign_id) REFERENCES campaigns(id)
  )`);
});

// Регистрация водителя
app.post('/driver/register', (req, res) => {
  const { name, phone, password } = req.body;
  db.run(`INSERT INTO drivers (name, phone, password) VALUES (?, ?, ?)`, [name, phone, password], function(err) {
    if (err) {
      console.error(err);
      return res.status(500).send({ message: 'Ошибка регистрации' });
    }
    res.send({ message: 'Регистрация успешна' });
  });
});

// Логин водителя
app.post('/driver/login', (req, res) => {
  const { phone, password } = req.body;
  db.get(`SELECT * FROM drivers WHERE phone = ? AND password = ?`, [phone, password], (err, row) => {
    if (err) {
      console.error(err);
      return res.status(500).send({ message: 'Внутренняя ошибка сервера' });
    }
    if (!row) {
      return res.status(401).send({ message: 'Неверный телефон или пароль' });
    }
    req.session.user = { id: row.id, type: 'driver', name: row.name };
    res.send({ message: 'Успешный вход' });
  });
});

// Получение профиля водителя
app.get('/driver/profile', (req, res) => {
  if (!req.session.user || req.session.user.type !== 'driver') {
    return res.status(401).send({ message: 'Необходимо войти в систему' });
  }
  const driverId = req.session.user.id;
  db.get(`SELECT id, name, phone, earnings FROM drivers WHERE id = ?`, [driverId], (err, row) => {
    if (err || !row) {
      console.error(err);
      return res.status(500).send({ message: 'Ошибка получения профиля' });
    }
    res.send(row);
  });
});

// Подача заявки на участие в кампании
app.post('/driver/apply', (req, res) => {
  if (!req.session.user || req.session.user.type !== 'driver') {
    return res.status(401).send({ message: 'Необходимо войти в систему' });
  }
  const driverId = req.session.user.id;
  const { campaign_id } = req.body;
  db.run(`INSERT INTO applications (driver_id, campaign_id) VALUES (?, ?)`, [driverId, campaign_id], function(err) {
    if (err) {
      console.error(err);
      return res.status(500).send({ message: 'Ошибка подачи заявки' });
    }
    res.send({ message: 'Заявка отправлена' });
  });
});

app.get('/driver/applications', (req, res) => {
  if (!req.session.user || req.session.user.type !== 'driver') {
    return res.status(401).send({ message: 'Необходимо войти в систему' });
  }
  const driverId = req.session.user.id;
  db.all(`
    SELECT applications.id, applications.campaign_id, campaigns.title, applications.status
    FROM applications
    JOIN campaigns ON applications.campaign_id = campaigns.id
    WHERE applications.driver_id = ?
  `, [driverId], (err, rows) => {
    if (err) {
      console.error(err);
      return res.status(500).send({ message: 'Ошибка получения заявок' });
    }
    res.send(rows);
  });
});


// Получение списка активных кампаний для водителя
app.get('/driver/campaigns', (req, res) => {
  db.all(`SELECT campaigns.id, campaigns.title, campaigns.budget, businesses.company_name
          FROM campaigns
          JOIN businesses ON campaigns.business_id = businesses.id
          WHERE campaigns.status = 'active'`, [], (err, rows) => {
    if (err) {
      console.error(err);
      return res.status(500).send({ message: 'Ошибка получения кампаний' });
    }
    res.send(rows);
  });
});

// Получение GPS данных от водителя
app.post('/driver/track', (req, res) => {
  if (!req.session.user || req.session.user.type !== 'driver') {
    return res.status(401).send({ message: 'Необходимо войти в систему' });
  }
  const driverId = req.session.user.id;
  const { campaign_id, distance, earnings } = req.body;

  // Проверка, что заявка на кампанию одобрена
  db.get(`SELECT * FROM applications WHERE driver_id = ? AND campaign_id = ? AND status = 'accepted'`, [driverId, campaign_id], (err, row) => {
    if (err) {
      console.error(err);
      return res.status(500).send({ message: 'Ошибка проверки заявки' });
    }
    if (!row) {
      return res.status(403).send({ message: 'Вы не одобрены для участия в этой кампании' });
    }

    db.run(`INSERT INTO routes (driver_id, campaign_id, distance, earnings, date) VALUES (?, ?, ?, ?, ?)`,
      [driverId, campaign_id, distance, earnings, new Date().toISOString()], function(err) {
        if (err) {
          console.error(err);
          return res.status(500).send({ message: 'Ошибка сохранения маршрута' });
        }
        // Обновление общего заработка водителя
        db.run(`UPDATE drivers SET earnings = earnings + ? WHERE id = ?`, [earnings, driverId], function(err) {
          if (err) {
            console.error(err);
            return res.status(500).send({ message: 'Ошибка обновления заработка' });
          }
          res.send({ message: 'Маршрут сохранен' });
        });
    });
  });
});

// Выход для водителя
app.post('/driver/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) {
      console.error(err);
      return res.status(500).send({ message: 'Ошибка при выходе из системы' });
    }
    res.send({ message: 'Вы вышли из системы' });
  });
});

// Регистрация бизнеса
app.post('/business/register', (req, res) => {
  const { company_name, contact_info, password } = req.body;
  db.run(`INSERT INTO businesses (company_name, contact_info, password) VALUES (?, ?, ?)`, [company_name, contact_info, password], function(err) {
    if (err) {
      console.error(err);
      return res.status(500).send({ message: 'Ошибка регистрации' });
    }
    res.send({ message: 'Регистрация успешна' });
  });
});

// Логин бизнеса
app.post('/business/login', (req, res) => {
  const { company_name, password } = req.body;
  db.get(`SELECT * FROM businesses WHERE company_name = ? AND password = ?`, [company_name, password], (err, row) => {
    if (err) {
      console.error(err);
      return res.status(500).send({ message: 'Внутренняя ошибка сервера' });
    }
    if (!row) {
      return res.status(401).send({ message: 'Неверное имя компании или пароль' });
    }
    req.session.user = { id: row.id, type: 'business', company_name: row.company_name };
    res.send({ message: 'Успешный вход' });
  });
});

// Получение профиля бизнеса
app.get('/business/profile', (req, res) => {
  if (!req.session.user || req.session.user.type !== 'business') {
    return res.status(401).send({ message: 'Необходимо войти в систему' });
  }
  const businessId = req.session.user.id;
  db.get(`SELECT id, company_name, contact_info FROM businesses WHERE id = ?`, [businessId], (err, row) => {
    if (err || !row) {
      console.error(err);
      return res.status(500).send({ message: 'Ошибка получения профиля' });
    }
    res.send(row);
  });
});

// Выход для бизнеса
app.post('/business/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) {
      console.error(err);
      return res.status(500).send({ message: 'Ошибка при выходе из системы' });
    }
    res.send({ message: 'Вы вышли из системы' });
  });
});

// Создание кампании
app.post('/business/campaigns', (req, res) => {
  if (!req.session.user || req.session.user.type !== 'business') {
    return res.status(401).send({ message: 'Необходимо войти в систему' });
  }
  const businessId = req.session.user.id;
  const { title, budget } = req.body;
  db.run(`INSERT INTO campaigns (business_id, title, budget) VALUES (?, ?, ?)`, [businessId, title, budget], function(err) {
    if (err) {
      console.error(err);
      return res.status(500).send({ message: 'Ошибка создания кампании' });
    }
    res.send({ message: 'Кампания создана' });
  });
});

// Получение списка кампаний бизнеса
app.get('/business/campaigns', (req, res) => {
  if (!req.session.user || req.session.user.type !== 'business') {
    return res.status(401).send({ message: 'Необходимо войти в систему' });
  }
  const businessId = req.session.user.id;
  db.all(`SELECT * FROM campaigns WHERE business_id = ?`, [businessId], (err, rows) => {
    if (err) {
      console.error(err);
      return res.status(500).send({ message: 'Ошибка получения кампаний' });
    }
    res.send(rows);
  });
});

// Получение списка заявок для бизнеса
app.get('/business/applications', (req, res) => {
  if (!req.session.user || req.session.user.type !== 'business') {
    return res.status(401).send({ message: 'Необходимо войти в систему' });
  }
  const businessId = req.session.user.id;
  db.all(`
    SELECT applications.id, drivers.name, drivers.phone, campaigns.title, applications.status
    FROM applications
    JOIN drivers ON applications.driver_id = drivers.id
    JOIN campaigns ON applications.campaign_id = campaigns.id
    WHERE campaigns.business_id = ? AND applications.status = 'pending'
  `, [businessId], (err, rows) => {
    if (err) {
      console.error(err);
      return res.status(500).send({ message: 'Ошибка получения заявок' });
    }
    res.send(rows);
  });
});

// Обновление статуса заявки
app.post('/business/applications/respond', (req, res) => {
  if (!req.session.user || req.session.user.type !== 'business') {
    return res.status(401).send({ message: 'Необходимо войти в систему' });
  }
  const { application_id, response: appResponse } = req.body; // appResponse: 'accepted' или 'rejected'

  if (!['accepted', 'rejected'].includes(appResponse)) {
    return res.status(400).send({ message: 'Неверный ответ на заявку' });
  }

  db.run(`UPDATE applications SET status = ? WHERE id = ?`, [appResponse, application_id], function(err) {
    if (err) {
      console.error(err);
      return res.status(500).send({ message: 'Ошибка обновления статуса заявки' });
    }
    res.send({ message: `Заявка ${appResponse === 'accepted' ? 'принята' : 'отклонена'}` });
  });
});

// Получение аналитики для бизнеса
app.get('/business/analytics', (req, res) => {
  if (!req.session.user || req.session.user.type !== 'business') {
    return res.status(401).send({ message: 'Необходимо войти в систему' });
  }
  const businessId = req.session.user.id;
  db.all(`SELECT campaigns.title, SUM(routes.distance) as total_distance, SUM(routes.earnings) as total_earnings
          FROM campaigns
          LEFT JOIN routes ON campaigns.id = routes.campaign_id
          WHERE campaigns.business_id = ?
          GROUP BY campaigns.id`, [businessId], (err, rows) => {
    if (err) {
      console.error(err);
      return res.status(500).send({ message: 'Ошибка получения аналитики' });
    }
    res.send(rows);
  });
});

// Запуск сервера
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Сервер запущен на http://localhost:${PORT}`);
});
