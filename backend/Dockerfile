# استفاده از نسخه سبک پایتون
FROM python:3.11-slim

# تنظیم پوشه کاری داخل کانتینر
WORKDIR /app

# کپی کردن فایل نیازمندی‌ها و نصب آن‌ها
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# کپی کردن کل سورس کد بک‌اند
COPY . .

# باز کردن پورت 8000
EXPOSE 8000

# اجرای سرور با uvicorn
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000"]