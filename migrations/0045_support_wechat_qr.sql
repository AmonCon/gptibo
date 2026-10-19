ALTER TABLE support_contacts ADD COLUMN wechat_qr TEXT NOT NULL DEFAULT '' CHECK(length(wechat_qr) <= 500000);
