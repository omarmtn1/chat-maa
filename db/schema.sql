-- ============================================
-- قاعدة بيانات مشروع "شات معا"
-- ============================================

CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    phone VARCHAR(20) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    display_name VARCHAR(50) NOT NULL,
    gender VARCHAR(10) NOT NULL CHECK (gender IN ('male', 'female')),
    age INT NOT NULL CHECK (age >= 13 AND age <= 100),
    avatar_url TEXT DEFAULT NULL,
    is_verified BOOLEAN DEFAULT true,
    agreed_terms BOOLEAN DEFAULT false,
    is_female_member BOOLEAN DEFAULT false,
    role VARCHAR(20) DEFAULT 'member' CHECK (role IN ('member', 'moderator', 'admin')),
    is_banned BOOLEAN DEFAULT false,
    ban_reason TEXT DEFAULT NULL,
    is_online BOOLEAN DEFAULT false,
    last_seen TIMESTAMP DEFAULT NOW(),
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS moderator_permissions (
    id SERIAL PRIMARY KEY,
    user_id INT UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    can_ban BOOLEAN DEFAULT false,
    can_delete_messages BOOLEAN DEFAULT false,
    can_warn BOOLEAN DEFAULT false,
    can_edit_names BOOLEAN DEFAULT false,
    can_manage_rooms BOOLEAN DEFAULT false
);

CREATE TABLE IF NOT EXISTS rooms (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    type VARCHAR(20) NOT NULL CHECK (type IN ('public', 'private')),
    password_hash VARCHAR(255) DEFAULT NULL,
    created_by INT REFERENCES users(id) ON DELETE SET NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS room_members (
    id SERIAL PRIMARY KEY,
    room_id INT REFERENCES rooms(id) ON DELETE CASCADE,
    user_id INT REFERENCES users(id) ON DELETE CASCADE,
    joined_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(room_id, user_id)
);

CREATE TABLE IF NOT EXISTS messages (
    id SERIAL PRIMARY KEY,
    room_id INT REFERENCES rooms(id) ON DELETE CASCADE,
    sender_id INT REFERENCES users(id) ON DELETE SET NULL,
    receiver_id INT DEFAULT NULL REFERENCES users(id) ON DELETE SET NULL,
    content TEXT NOT NULL,
    message_type VARCHAR(20) DEFAULT 'text' CHECK (message_type IN ('text', 'emoji', 'poke', 'system')),
    is_deleted BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS admin_messages (
    id SERIAL PRIMARY KEY,
    user_id INT REFERENCES users(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    is_read BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS complaints (
    id SERIAL PRIMARY KEY,
    user_id INT REFERENCES users(id) ON DELETE SET NULL,
    against_user_id INT REFERENCES users(id) ON DELETE SET NULL,
    content TEXT NOT NULL,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'reviewed', 'closed')),
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS banned_words (
    id SERIAL PRIMARY KEY,
    word VARCHAR(100) UNIQUE NOT NULL,
    added_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS warnings (
    id SERIAL PRIMARY KEY,
    user_id INT REFERENCES users(id) ON DELETE CASCADE,
    reason TEXT NOT NULL,
    issued_by INT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ad_ticker_settings (
    id SERIAL PRIMARY KEY,
    text_content TEXT DEFAULT 'مرحباً بكم في شات معا',
    speed INT DEFAULT 5,
    direction VARCHAR(10) DEFAULT 'right' CHECK (direction IN ('right', 'left')),
    font_size INT DEFAULT 16,
    bg_color VARCHAR(20) DEFAULT '#1e88e5',
    text_color VARCHAR(20) DEFAULT '#ffffff',
    is_visible BOOLEAN DEFAULT true,
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS maintenance_mode (
    id SERIAL PRIMARY KEY,
    is_active BOOLEAN DEFAULT false,
    reason TEXT DEFAULT NULL,
    restart_time TIMESTAMP DEFAULT NULL,
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS admin_logs (
    id SERIAL PRIMARY KEY,
    admin_id INT REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(100) NOT NULL,
    target_user_id INT REFERENCES users(id) ON DELETE SET NULL,
    details TEXT DEFAULT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

INSERT INTO ad_ticker_settings (text_content) 
    SELECT 'مرحباً بكم في شات معا 💬' WHERE NOT EXISTS (SELECT 1 FROM ad_ticker_settings);

INSERT INTO maintenance_mode (is_active) 
    SELECT false WHERE NOT EXISTS (SELECT 1 FROM maintenance_mode);

INSERT INTO rooms (name, type, is_active)
    SELECT 'الدردشة العامة', 'public', true
    WHERE NOT EXISTS (SELECT 1 FROM rooms WHERE type = 'public' AND name = 'الدردشة العامة');
