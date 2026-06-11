FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y fluidsynth ffmpeg curl && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Download FluidR3_GM SoundFont to assets folder
RUN mkdir -p /app/assets/soundfonts && \
    curl -L -o /app/assets/soundfonts/FluidR3_GM.sf2 "https://github.com/urish/caniuse-midi/raw/master/public/soundfonts/FluidR3_GM.sf2"

COPY app ./app

EXPOSE 5050

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "5050"]
