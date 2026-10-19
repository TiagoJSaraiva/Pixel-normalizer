# Pixel Normalizer (TypeScript + Bun)

Um único script (`pixel-normalizer.ts`) que tenta detectar o tamanho e o deslocamento da grade lógica em pixel art gerada por IA. Ele normaliza os pixels sem alterar as dimensões da imagem e salva 3 métodos para cada uma das 2 melhores grades.

## Executar

```sh
bun install
bun run pixel-normalizer.ts "minha-imagem.png"
bun run pixel-normalizer.ts "minha-imagem.png" --out ./forja
```

Coloque as imagens em `input/`. O argumento da imagem é relativo a essa pasta; por exemplo, `"minha-imagem.png"` lê `input/minha-imagem.png`. Subpastas também são aceitas, como `"personagens/heroi.png"`, desde que permaneçam dentro de `input/`.

Todos os resultados ficam sob `output/`. Sem `--out`, o nome base é `normalized-output`; com `--out ./forja`, o nome base é `forja`. Se uma pasta com esse nome já existir, o script cria a próxima pelo maior sufixo encontrado: com `forja/`, `forja-2/` e `forja-5/`, cria `forja-6/`.

Para substituir a pasta base exata, removendo todo o conteúdo dela, use `--overwrite` ou `-o`:

```sh
bun run pixel-normalizer.ts "minha-imagem.png" --out ./forja --overwrite
bun run pixel-normalizer.ts "minha-imagem.png" --out ./forja -o
```

Com essa opção, o destino é sempre `output/forja`, mesmo que pastas como `output/forja-2/` também existam.

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
