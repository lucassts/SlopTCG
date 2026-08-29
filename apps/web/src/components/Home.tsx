import { useState } from 'react';

export interface HomeProps {
  onCreate: (name: string) => void;
  onJoin: (name: string, code: string) => void;
  connecting: boolean;
}

export function Home({ onCreate, onJoin, connecting }: HomeProps) {
  const [name, setName] = useState(localStorage.getItem('sloptcg-name') ?? '');
  const [code, setCode] = useState('');

  const remember = (n: string) => {
    setName(n);
    localStorage.setItem('sloptcg-name', n);
  };

  return (
    <div className="screen-center">
      <div className="brand">
        SlopTCG
        <small>card games no navegador · código aberto</small>
      </div>
      <div className="home-card">
        <input
          placeholder="Seu nome"
          value={name}
          maxLength={32}
          onChange={(e) => remember(e.target.value)}
        />
        <button className="primary" disabled={!name.trim() || connecting} onClick={() => onCreate(name.trim())}>
          Criar sala
        </button>
        <div className="row">
          <input
            placeholder="CÓDIGO"
            value={code}
            maxLength={5}
            style={{ textTransform: 'uppercase', letterSpacing: 4, textAlign: 'center' }}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && code.length === 5 && name.trim()) onJoin(name.trim(), code);
            }}
          />
          <button disabled={!name.trim() || code.length !== 5 || connecting} onClick={() => onJoin(name.trim(), code)}>
            Entrar na sala
          </button>
        </div>
        <div className="muted">
          Crie uma sala e mande o código para o seu oponente — é só isso o matchmaking, por enquanto.
        </div>
      </div>
      <div className="muted" style={{ maxWidth: 480, textAlign: 'center', fontSize: 12 }}>
        Engine de card games de código aberto, para estudo e uso não comercial. Sem afiliação com a
        Wizards of the Coast ou qualquer empresa de jogos; dados de cartas vêm do Scryfall em tempo
        real, sob a Fan Content Policy. Marcas citadas pertencem aos seus donos.
      </div>
    </div>
  );
}
