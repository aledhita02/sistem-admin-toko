const express = require('express');
const mysql = require('mysql2');
const bodyParser = require('body-parser');
const session = require('express-session'); // Tambahan untuk login
const path = require('path');

const app = express();
const port = 3000;

// --- KONFIGURASI MIDDLEWARE ---
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(bodyParser.urlencoded({ extended: false }));
app.use(express.static('public'));

// Konfigurasi Session
app.use(session({
    secret: 'rahasia_toko_admin_kunci', // Ganti dengan string acak
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 3600000 } // Sesi berlaku 1 jam
}));

// --- DATABASE ---
const db = mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'toko_admin_db'
});

db.connect((err) => {
    if (err) console.error('DB Error: ' + err.stack);
    else console.log('Terhubung ke Database MySQL');
});

// --- MIDDLEWARE CEK LOGIN ---
const requireLogin = (req, res, next) => {
    if (!req.session.user) {
        return res.redirect('/login');
    }
    next();
};

// --- ROUTES AUTH ---

// 1. Halaman Login
app.get('/login', (req, res) => {
    // Jika sudah login, lempar ke dashboard
    if (req.session.user) return res.redirect('/');
    res.render('login', { error: null });
});

// 2. Proses Login
app.post('/login', (req, res) => {
    const { username, password } = req.body;

    db.query('SELECT * FROM users WHERE username = ? AND password = ?', [username, password], (err, results) => {
        if (err) throw err;

        if (results.length > 0) {
            // Login Sukses
            req.session.user = results[0];
            res.redirect('/');
        } else {
            // Login Gagal
            res.render('login', { error: 'Username atau Password salah!' });
        }
    });
});

// 3. Logout
app.get('/logout', (req, res) => {
    req.session.destroy(() => {
        res.redirect('/login');
    });
});

// --- ROUTES APLIKASI (DIPROTEKSI) ---

// 4. Dashboard (Perlu Login)
app.get('/', requireLogin, (req, res) => {
    const queryProducts = `SELECT p.id, p.name, p.price, s.quantity FROM products p JOIN stocks s ON p.id = s.product_id ORDER BY p.name ASC`;
    const queryPurchases = `SELECT pur.id, p.name, pur.quantity, pur.total_price, pur.status, pur.created_at FROM purchases pur JOIN products p ON pur.product_id = p.id ORDER BY pur.created_at DESC`;

    db.query(queryProducts, (err, products) => {
        if (err) throw err;
        db.query(queryPurchases, (err, purchases) => {
            if (err) throw err;
            // Kirim data user ke view untuk ditampilkan di navbar
            res.render('index', { products, purchases, user: req.session.user });
        });
    });
});

// 5. Input Pembelian
app.post('/buy', requireLogin, (req, res) => {
    const { product_id, quantity } = req.body;
    const qty = parseInt(quantity);

    if (!product_id || qty <= 0) return res.send('<script>alert("Data tidak valid!"); window.location="/";</script>');

    db.query('SELECT p.price, s.quantity FROM products p JOIN stocks s ON p.id = s.product_id WHERE p.id = ?', [product_id], (err, results) => {
        if (err) throw err;
        if (results.length === 0) return res.send('Produk error');

        const { price, quantity: currentStock } = results[0];
        if (currentStock < qty) return res.send('<script>alert("Stok kurang!"); window.location="/";</script>');

        const totalPrice = price * qty;

        db.beginTransaction(err => {
            if (err) throw err;
            db.query('UPDATE stocks SET quantity = quantity - ? WHERE product_id = ?', [qty, product_id], err => {
                if (err) return db.rollback(() => { throw err; });
                db.query('INSERT INTO purchases (product_id, quantity, total_price) VALUES (?, ?, ?)', [product_id, qty, totalPrice], err => {
                    if (err) return db.rollback(() => { throw err; });
                    db.commit(err => {
                        if (err) return db.rollback(() => { throw err; });
                        res.redirect('/');
                    });
                });
            });
        });
    });
});

// 6. Cancel
app.post('/cancel/:id', requireLogin, (req, res) => {
    const purchaseId = req.params.id;
    db.query('SELECT product_id, quantity, status FROM purchases WHERE id = ?', [purchaseId], (err, results) => {
        if (err) throw err;
        if (results.length === 0 || results[0].status === 'cancelled') return res.redirect('/');

        const purchase = results[0];
        db.beginTransaction(err => {
            if (err) throw err;
            db.query('UPDATE purchases SET status = "cancelled" WHERE id = ?', [purchaseId], err => {
                if (err) return db.rollback(() => { throw err; });
                db.query('UPDATE stocks SET quantity = quantity + ? WHERE product_id = ?', [purchase.quantity, purchase.product_id], err => {
                    if (err) return db.rollback(() => { throw err; });
                    db.commit(err => {
                        if (err) return db.rollback(() => { throw err; });
                        res.redirect('/');
                    });
                });
            });
        });
    });
});

app.listen(port, () => {
    console.log(`Server berjalan di http://localhost:${port}`);
});