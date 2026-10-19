# Pixel Normalizer (TypeScript + Bun)

Um único script (`pixel-normalizer.ts`) que tenta detectar o tamanho e o deslocamento da grade lógica em pixel art gerada por IA. Ele normaliza os pixels sem alterar as dimensões da imagem e salva 3 métodos para cada uma das 2 melhores grades.

## Executar

```sh
bun install
bun run pixel-normalizer.ts "minha-imagem.png" --out ./resultado
```

Opções disponíveis:

```sh
bun run pixel-normalizer.ts --help
bun run pixel-normalizer.ts "minha-imagem.png" --out ./resultado --max-cell 160 --grids 3
```

O script gera, na pasta de saída:

- `comparativo.png`: visualização da imagem original e das variantes.
- `grade-*-dominante.png`: cor do agrupamento de cores mais frequente em cada célula.
- `grade-*-mediana.png`: mediana de cada canal na célula.
- `grade-*-centro.png`: a cor do pixel do centro da célula.
- `report.json`: grade estimada, deslocamentos e pontuações heurísticas.

## Como funciona

1. Mede o contraste médio entre colunas/linhas vizinhas.
2. Testa tamanhos candidatos de 3 a 128 pixels (configurável).
3. Encontra o deslocamento horizontal e vertical que melhor faz as bordas coincidirem com uma grade.
4. Penaliza coincidências baseadas em poucas bordas e seleciona tamanhos alternativos.
5. Preenche cada célula inteira com a cor representativa, preservando a resolução original.

**Limitação:** a estimativa é heurística. Se a IA variar o tamanho dos pixels entre diferentes regiões da imagem ou não tiver uma grade global bem definida, nenhuma grade uniforme conseguirá reproduzir perfeitamente todos os detalhes. A grade alternativa e os três métodos ajudam na comparação visual.

## Tecnologia

- TypeScript, runtime Bun
- Sharp (única dependência externa)
- Não precisa de Python, OpenCV nem serviço de IA.
