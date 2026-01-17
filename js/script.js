import { SUITS_SVG, MAX_HAND_SIZE, INITIAL_HAND_SIZE } from "./constants.js";
import {
  db,
  ref,
  set,
  onValue,
  update,
  get,
  push,
  runTransaction,
} from "./firebase-config.js";

////// 1. Game State Variables //////

let state = {
  myPlayerId: null, // "player1" / "player2"
  currentRoomId: null, // Room name
  knownCardIds: new Set(), // Animations
  knownOpCardIds: new Set(), // Animations opponent
  waitingForTarget: null, // Target mode card ID
};

////// 2. DOM SELECTORS //////

const loginScreen = document.getElementById("login-screen");
const gameScreen = document.getElementById("game-screen");
const btnEnter = document.getElementById("btn-enter");
const inputName = document.getElementById("name-input");
const inputRoom = document.getElementById("room-input");
const deckElement = document.getElementById("deck-pile");
const myPointsZone = document.getElementById("my-pts");
const discardZone = document.getElementById("discard-pile");
const myNameDisplay = document.getElementById("my-name");
const opNameDisplay = document.getElementById("op-name");
// const deckCountDisplay = document.getElementById("deck-count");
// const roomDisplay = document.getElementById("room-display");
const statusMsg = document.getElementById("status-msg");
const myHandDiv = document.getElementById("my-hand");
const opHandDiv = document.getElementById("op-hand");

////// 3. FUNCTIONS //////

async function joinRoom(roomNameInput, playerName) {
  const roomName = roomNameInput.trim();
  if (!roomName) {
    alert("Digite um nome para a sala!");
    return false;
  }

  const roomRef = ref(db, `rooms/${roomName}`);

  try {
    const snapshot = await get(roomRef);
    const roomData = snapshot.val();

    // OPTION 1: Create Room if it doesn't exist
    // OPTION 2: Enter Room (New Player 2)
    // OPTION 3: Reconnection Cases (Same name as p1/p2)

    if (!roomData) {
      console.log(`Sala ${roomName} não existe. Criando...`);

      const fullDeck = shuffleDeck(createFullDeck()); // Deck creation and shuffle
      const handArray1 = fullDeck.splice(0, INITIAL_HAND_SIZE); // Deal initial hand
      const hand1 = convertArrayToHandObject(handArray1); // Converts Array to Object

      const initialData = {
        status: "waiting",
        turn: "player1",
        player1: {
          name: playerName,
          hand: hand1,
          table: {},
          score: 0,
          wins: 0,
        },
        player2: null,
        deck: fullDeck,
        discardPile: [],
      };

      await set(roomRef, initialData);
      state.myPlayerId = "player1";
    } else {
      console.log(`Sala ${roomName} encontrada. Entrando...`);

      if (roomData.player1 && roomData.player2) {
        if (
          roomData.player1.name !== playerName &&
          roomData.player2.name !== playerName
        ) {
          alert("Sala cheia!");
          return false;
        }
      } // Full room check
      if (!roomData.player2 && roomData.player1.name !== playerName) {
        const currentDeck = roomData.deck || []; // Get current deck
        const handArray2 = currentDeck.splice(0, INITIAL_HAND_SIZE); // Deal initial hand
        const hand2 = convertArrayToHandObject(handArray2); // Converts Array to Object

        await update(roomRef, {
          player2: {
            name: playerName,
            hand: hand2,
            table: {},
            score: 0,
            wins: 0,
          },
          status: "ready",
          deck: currentDeck, // Update deck after dealing
        });
        state.myPlayerId = "player2";
      } else {
        // Reconnection
        state.myPlayerId =
          roomData.player1.name === playerName ? "player1" : "player2";
      }
    }

    state.currentRoomId = roomName;

    startGameListener(roomRef);

    return true;
  } catch (error) {
    console.error("Erro fatal ao entrar na sala:", error);
    alert("Erro ao conectar no banco de dados.");
    return false;
  }
} //// ROOM CREATION / JOINING

function startGameListener(roomRef) {
  // Main game loop listener function.
  // roomDisplay.innerText = `Sala: ${state.currentRoomId}`;
  console.log(`State: ${state.myPlayerId} / ${state.currentRoomId}`);

  // onValue runs every time Firebase data changes in this room
  onValue(roomRef, (snapshot) => {
    const data = snapshot.val();
    if (!data) return;

    // 1. Player identification
    const me = data[state.myPlayerId];
    const opId = state.myPlayerId === "player1" ? "player2" : "player1";
    const op = data[opId];

    if (!op) return; // If no opponent yet, wait

    // 2. Visual Updates (Hands / Tables / Names)
    myNameDisplay.innerText = me.name;
    opNameDisplay.innerText = op.name;

    // THE GLASS [8] Logic: Verify if I have any 8s on my table
    // TODO: Need to add option to use 8 to point or be used as the glass
    const myTableArr = Object.values(me.table || {});
    const iHaveGlasses = myTableArr.some((card) => card.face === "8");

    // Render hands (with animation for new cards)
    renderRemoteHand(me.hand, data);
    renderOpponentHand(op.hand, iHaveGlasses);

    // Render table (points / royals)
    renderTable(me.table, "my-pts");

    // Add click for SCUTTLE on opponent's table
    renderTable(op.table, "op-pts", (targetId) => {
      attemptMove("scuttle", targetId);
    });

    // 3. Calculate points (game math to check if someone won)
    const myStats = calculateTableStats(me.table);
    const opStats = calculateTableStats(op.table);

    // Define points goals based on Kings ( p1 / p2 )
    const myGoal = getWinningGoal(myStats.kings);
    const opGoal = getWinningGoal(opStats.kings);

    // Store points in variables for victory logic below
    const myPoints = myStats.points;
    const opPoints = opStats.points;

    // Update points display
    document.getElementById("my-score").innerText =
      `${myPoints} / ${myGoal} pts`;
    document.getElementById("op-score").innerText =
      `${opPoints} / ${opGoal} pts`;

    // 4. Game State Updates (Deck / Discard Pile / Status Messages)

    // document.getElementById("deck-count").innerText = data.deck
    //   ? data.deck.length
    //   : 0;

    renderDeckState(data.deck); // Visual deck pile
    renderDiscardPile(data.discardPile); // Visual discard pile

    // Refresh status message (Your turn / Counter / ...)
    updateStatusMessage(
      data.status,
      data.turn,
      state.myPlayerId,
      data.pendingAction
    );

    // [3] One-off - Fishing Modal Logic
    if (
      data.status === "waiting_fishing_3" &&
      data.pendingAction.source === state.myPlayerId
    ) {
      const modal = document.getElementById("discard-modal");
      // Só abre se já não estiver aberto (para não piscar)
      if (modal.classList.contains("hidden")) {
        console.log("Abrindo modal de pesca (Efeito do 3)");
        openDiscardModal("pick", data);
      }
    }
    // Close modal if not fishing turn
    if (data.status !== "waiting_fishing_3") {
      const modal = document.getElementById("discard-modal");
      if (
        !modal.classList.contains("hidden") &&
        document
          .getElementById("modal-instruction")
          .innerText.includes("PESCAR")
      ) {
        modal.classList.add("hidden");
      }
    }

    // 5. Victory Logic (Auto Check)
    if (data.status !== "game_over") {
      if (myPoints >= myGoal) {
        console.log("Atingi a meta! Enviando vitória...");
        handleGameOver(state.myPlayerId);
      }
    }

    // 6. Game Over (Open Modal) ---
    if (data.status === "game_over" && data.winner) {
      const iWon = data.winner === state.myPlayerId;
      openGameOverModal(iWon, data.player1, data.player2, state.myPlayerId);
    } else {
      const modal = document.getElementById("game-over-modal");
      if (modal && !modal.classList.contains("hidden")) {
        modal.classList.add("hidden");
      }
    }
  });
} //// GAME LOOP

///// 3.1. RENDER FUNCTIONS /////

function renderRemoteHand(handData, roomData) {
  myHandDiv.innerHTML = "";

  if (!handData) {
    state.knownCardIds.clear();
    return;
  }

  const currentIdsInHand = new Set();

  const cardsArray = Object.values(handData);

  Object.entries(handData).forEach(([fireId, cardData]) => {
    // 1. Cria o elemento
    const cardDiv = createCardVisual(cardData, fireId);

    if (
      roomData.status === "waiting_discard_4" &&
      roomData.pendingAction.victim === state.myPlayerId
    ) {
      cardDiv.classList.add("must-discard");
    }

    // 2. Adiciona evento de clique para seleção
    cardDiv.addEventListener("click", async () => {
      // --- LÓGICA DO 4: Clique para Descartar ---
      // Se estamos no modo 'waiting_discard_4' e EU sou a vítima
      if (
        roomData.status === "waiting_discard_4" &&
        roomData.pendingAction.victim === state.myPlayerId
      ) {
        if (confirm("Descartar esta carta?")) {
          console.log("Descartando por obrigação:", fireId);

          const updates = {};
          const discardPath = `rooms/${state.currentRoomId}/discardPile`;

          // 1. Joga a carta no lixo
          const newKey = push(ref(db, discardPath)).key;
          updates[`${discardPath}/${newKey}`] = cardData;

          // 2. Remove da mão
          updates[
            `rooms/${state.currentRoomId}/${state.myPlayerId}/hand/${fireId}`
          ] = null;

          // 3. Verifica o progresso
          const currentCount = roomData.pendingAction.discardCount || 0;
          const newCount = currentCount + 1;
          const handSize = Object.keys(
            roomData[state.myPlayerId].hand || {}
          ).length;

          // --- CORREÇÃO DO ERRO DE CAMINHOS ---

          // CASO A: ACABOU (Já descartou 2 ou não tem mais cartas)
          if (newCount >= 2 || handSize <= 1) {
            console.log("Descartes concluídos. Voltando ao jogo.");

            // Limpa a pendência inteira (PAI)
            updates[`rooms/${state.currentRoomId}/pendingAction`] = null;
            updates[`rooms/${state.currentRoomId}/status`] = "ready";

            // A vez passa para MIM (A vítima), pois o turno do oponente acabou ao jogar o 4.
            updates[`rooms/${state.currentRoomId}/turn`] = state.myPlayerId;
            updates[`rooms/${state.currentRoomId}/lastAction`] =
              "Descartes realizados.";
          }
          // CASO B: AINDA FALTA UM (Só atualiza o contador)
          else {
            // Atualiza apenas o contador (FILHO)
            updates[`rooms/${state.currentRoomId}/pendingAction/discardCount`] =
              newCount;
          }

          await update(ref(db), updates);
        }
        return;
      }

      // 1. Verifica se essa carta já estava selecionada antes do clique
      const estavaSelecionada = cardDiv.classList.contains("selected");

      // 2. Limpa a seleção de TODAS as cartas da mão visualmente
      // (Garante que apenas uma fique selecionada por vez)
      for (let c of myHandDiv.getElementsByClassName("card")) {
        c.classList.remove("selected");
      }

      // 3. Aplica a seleção na carta clicada (se ela não estava selecionada)
      if (!estavaSelecionada) {
        cardDiv.classList.add("selected");
        console.log("Selecionou:", cardData);
      }

      // --- 4. LÓGICA DE RESET DE MIRA (UX) ---
      // Se o jogador estava no "Modo de Mira" (tinha clicado no 9 + Lixo e as cartas estavam brilhando)
      // mas decidiu clicar em OUTRA carta da mão, precisamos cancelar a mira.
      if (state.waitingForTarget && state.waitingForTarget !== fireId) {
        console.log("Cancelando modo de mira pois trocou de carta.");

        state.waitingForTarget = null; // Limpa a memória do alvo
        updateTargetVisuals(); // Apaga as luzes da mesa do oponente

        // Restaura o texto de status para o normal
        const statusMsg = document.getElementById("status-msg");
        if (statusMsg) {
          statusMsg.innerText = "Sua vez de jogar"; // Texto padrão
          statusMsg.style.color = ""; // Remove a cor laranja
        }
      }
    });

    myHandDiv.appendChild(cardDiv);

    if (!state.knownCardIds.has(fireId)) {
      animateCardFromDeck(cardDiv);
    }
    currentIdsInHand.add(fireId);
  });

  state.knownCardIds = currentIdsInHand;

  // Ajusta o leque visualmente
  setTimeout(() => adjustHand(myHandDiv), 10);
}

function renderOpponentHand(handData, reveal = false) {
  const opHandDiv = document.getElementById("op-hand");
  opHandDiv.innerHTML = "";

  if (!handData) {
    state.knownOpCardIds.clear();
    return;
  }

  const currentOpIds = new Set();

  Object.entries(handData).forEach(([fireId, cardData]) => {
    let cardDiv;

    if (reveal) {
      // --- MODO VISÍVEL (Efeito do 8) ---
      // Reutiliza a função que cria a carta bonita com naipe e número
      cardDiv = createCardVisual(cardData, fireId);

      // Adiciona uma classe para diferenciar visualmente (opcional)
      cardDiv.classList.add("revealed-hand");

      // Importante: Removemos interatividade (não pode clicar na mão dele)
      cardDiv.style.pointerEvents = "none";
    } else {
      // --- MODO OCULTO (Padrão) ---
      cardDiv = document.createElement("div");
      cardDiv.classList.add("card");
      // Mantém o verso da carta
      cardDiv.innerHTML = `<div class="card-back-pattern"></div>`;
    }

    opHandDiv.appendChild(cardDiv);

    // Animação de entrada (só se a carta for nova)
    if (!state.knownOpCardIds.has(fireId)) {
      animateCardFromDeck(cardDiv);
    }

    currentOpIds.add(fireId);
  });

  state.knownOpCardIds = currentOpIds;

  // Ajusta o leque
  setTimeout(() => adjustHand(opHandDiv), 10);
}

function renderDeckState(deckData) {
  const deckElement = document.getElementById("deck-pile");
  deckElement.innerHTML = "";
  const count = deckData ? deckData.length : 0;

  if (count === 0) {
    deckElement.classList.add("empty");
    deckElement.classList.remove("deck");
  } else {
    deckElement.classList.remove("empty");
    deckElement.classList.add("deck");
    const visualStackCount = Math.min(count, 3);

    for (let i = 0; i < visualStackCount; i++) {
      const cardBack = document.createElement("div");
      cardBack.classList.add("card");

      // Adiciona o padrão do verso (que vai pegar sua imagem do CSS)
      cardBack.innerHTML = '<div class="card-back-pattern"></div>';

      // Estilização da Pilha
      cardBack.style.position = "absolute";
      cardBack.style.top = "0";
      cardBack.style.left = "0";

      // Deslocamento suave (ex: 2px para baixo e direita por carta)
      const offset = i * 4;
      cardBack.style.transform = `translate(${offset}px, ${offset}px)`;

      // Z-index garante que a pilha suba visualmente
      cardBack.style.zIndex = i;

      // Adiciona ao elemento do Deck
      deckElement.appendChild(cardBack);
    }

    // Garante que o contador fique EM CIMA das cartas visuais
    // deckCountDisplay.style.zIndex = 100;
  }
}

function renderTable(tableData, containerId, isOpponent = false) {
  const container = document.getElementById(containerId);
  container.innerHTML = "";

  if (!tableData) return;

  // --- 1. DETECÇÃO DE INTENÇÃO (O SEGREDO) ---
  // Verifica qual carta o jogador tem selecionada na mão agora
  const selectedEl = document.querySelector("#my-hand .card.selected");
  let interactionMode = "neutral"; // neutral, effect_2, effect_9, scuttle, steal_jack

  if (selectedEl) {
    const face = selectedEl.dataset.face;

    if (face === "9") interactionMode = "effect_9";
    else if (face === "2") interactionMode = "effect_2";
    else if (face === "J") interactionMode = "steal_jack";
    else if (["A", "3", "4", "5", "6", "7", "8", "10"].includes(face))
      interactionMode = "scuttle";
  }

  // Se já estiver no "Modo de Mira" (clicou no 9 ou J e está esperando alvo)
  if (state.waitingForTarget) {
    // Descobre qual era a carta original que iniciou a mira
    const originalCard = document.querySelector(
      `#my-hand .card[data-id="${state.waitingForTarget}"]`
    );
    if (originalCard) {
      const f = originalCard.dataset.face;
      if (f === "9") interactionMode = "effect_9";
      if (f === "J") interactionMode = "steal_jack";
      if (f === "2") interactionMode = "effect_2";
    }
  }

  // ---------------------------------------------

  const allCards = Object.entries(tableData);
  const childrenIds = new Set();
  const jacksByTarget = {};

  // Mapeamento (igual ao anterior)
  allCards.forEach(([id, card]) => {
    if (card.stealing && tableData[card.stealing]) {
      childrenIds.add(id);
      if (!jacksByTarget[card.stealing]) jacksByTarget[card.stealing] = [];
      jacksByTarget[card.stealing].push({ id, ...card });
    }
  });

  // Renderização
  allCards.forEach(([id, card]) => {
    if (childrenIds.has(id)) return; // Pula filhos

    const myJacks = jacksByTarget[id];

    if (myJacks && myJacks.length > 0) {
      // --- É UM GRUPO ---
      const groupDiv = document.createElement("div");
      groupDiv.className = "card-group";

      // 1. A Carta de Ponto (Base)
      const baseDiv = createCardVisual(card, id);
      baseDiv.classList.add("point-card");
      setupTableClick(baseDiv, id, isOpponent);

      // >>> A LÓGICA DO CLICK-THROUGH <<<
      // Se tiver Valetes em cima, a carta de baixo vira "fantasma" para evitar bugs,
      // EXCETO se precisarmos clicar nela explicitamente (9, Scuttle ou Roubo).
      const pointMustBeClickable =
        interactionMode === "effect_9" ||
        interactionMode === "scuttle" ||
        interactionMode === "steal_jack";

      if (!pointMustBeClickable) {
        baseDiv.classList.add("pass-through");
      }
      // >>>>>>>>>>>><<<<<<<<<<<<<<<<<<<<<

      groupDiv.appendChild(baseDiv);

      // 2. Os Valetes
      myJacks.forEach((jack, index) => {
        const jackDiv = createCardVisual(jack, jack.id);
        jackDiv.classList.add("jack-overlay");
        jackDiv.style.zIndex = 10 + index;

        // Ajuste para não bugar o hover:
        // Se eu estiver segurando um 2, quero clicar no Valete, então ele precisa ser o alvo.
        // Se eu estiver segurando um 9, quero poder clicar no Valete também.
        // O Valete SEMPRE deve receber cliques (ele nunca é pass-through).

        const verticalOffset = (index + 1) * 30;
        jackDiv.style.transform = `translateY(${verticalOffset}px) rotate(2deg)`;

        setupTableClick(jackDiv, jack.id, isOpponent);
        groupDiv.appendChild(jackDiv);
      });

      container.appendChild(groupDiv);
    } else {
      // --- CARTA SOLTA ---
      const cardDiv = createCardVisual(card, id);
      cardDiv.classList.add("table-card");
      setupTableClick(cardDiv, id, isOpponent);
      container.appendChild(cardDiv);
    }
  });
  updateTableInteractivity();
}

function renderDiscardPile(discardData) {
  const discardContainer = document.querySelector("#discard-pile .card-slot");
  discardContainer.innerHTML = "";

  if (!discardData) {
    // Mostra o placeholder se estiver vazio
    discardContainer.innerHTML = '<div class="card-placeholder">Descarte</div>';
    return;
  }

  const cards = Object.values(discardData);

  // 1. Pega no máximo as 3 últimas cartas
  const last3Cards = cards.slice(-3);

  // 2. Renderiza cada uma delas
  last3Cards.forEach((cardData, index) => {
    // Usamos um ID fictício pois não precisamos clicar nelas individualmente
    const cardDiv = createCardVisual(cardData, `discard-${index}`);

    // --- ESTILIZAÇÃO DA PILHA ---

    // Remove interações
    cardDiv.style.pointerEvents = "none";

    // Define posição absoluta para elas ficarem uma em cima da outra
    cardDiv.style.position = "absolute";

    // Removemos a rotação torta e aplicamos um deslocamento leve
    // A carta 0 fica no (0,0), a carta 1 no (2px, 2px), a carta 2 no (4px, 4px)
    const offset = index * 4;
    cardDiv.style.transform = `translate(${offset}px, ${offset}px)`;

    // Garante que a mais nova fique por cima (z-index maior)
    cardDiv.style.zIndex = index;

    discardContainer.appendChild(cardDiv);
  });
}

//// 3.2. UTILITY FUNCTIONS /////

function createFullDeck() {
  const suits = ["hearts", "diamonds", "clubs", "spades"];
  const ranks = [
    { face: "A", power: 1 },
    { face: "2", power: 2 },
    { face: "3", power: 3 },
    { face: "4", power: 4 },
    { face: "5", power: 5 },
    { face: "6", power: 6 },
    { face: "7", power: 7 },
    { face: "8", power: 0 },
    { face: "9", power: 9 },
    { face: "10", power: 10 },
    { face: "J", power: 0 },
    { face: "Q", power: 0 },
    { face: "K", power: 0 },
  ];

  let deck = [];

  for (let suit of suits) {
    for (let rank of ranks) {
      deck.push({
        suit: suit,
        face: rank.face,
        power: rank.power,
        id: `${rank.face}-${suit[0].toUpperCase()}`,
      });
    }
  }

  return deck;
} // 52 Card full deck creation

function shuffleDeck(deck) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
} // Deck shuffler using Fisher-Yates Shuffle Logic

function setupTableClick(cardDiv, fireId, isOpponent) {
  if (!isOpponent) return;

  cardDiv.addEventListener("click", (e) => {
    e.stopPropagation();

    if (state.waitingForTarget) {
      // Lógica do Valete Roubando Valete (Transferência) ou mira normal
      const myHandElem = document.querySelector(
        `#my-hand .card[data-id="${state.waitingForTarget}"]`
      );
      const myFace = myHandElem ? myHandElem.dataset.face : "";

      let action = "play_effect";
      if (myFace === "J") action = "play_jack";

      attemptMove(action, fireId);
      state.waitingForTarget = null;
      updateTargetVisuals();
      return;
    }

    const mySelected = document.querySelector("#my-hand .card.selected");
    if (mySelected) {
      const myFace = mySelected.dataset.face;
      if (["2", "9"].includes(myFace)) attemptMove("play_effect", fireId);
      else if (myFace === "J") attemptMove("play_jack", fireId);
      else attemptMove("scuttle", fireId);
    }
  });
} // Table click helper (Avoid double click code executions, ...)

function updateTableInteractivity() {
  const selectedEl = document.querySelector("#my-hand .card.selected");
  let interactionMode = "neutral";

  // 1. Descobre a intenção baseada na carta selecionada
  if (selectedEl) {
    const face = selectedEl.dataset.face;

    if (face === "9") interactionMode = "effect_9";
    else if (face === "2") interactionMode = "effect_2";
    else if (face === "J") interactionMode = "steal_jack";
    else if (["A", "3", "4", "5", "6", "7", "8", "10"].includes(face))
      interactionMode = "scuttle";
  }

  // Se estiver no "Modo de Mira" (esperando clique), mantém a intenção original
  if (state.waitingForTarget) {
    // (Opcional: Se quiser refinar, pode buscar a carta original pelo ID salvo em state)
    // Por padrão, assumimos que se está esperando alvo, precisa clicar.
    interactionMode = "targeting";
  }

  // 2. Define se o Ponto deve ser clicável
  // Se for Neutral ou Efeito do 2 (que foca em Valetes), o Ponto é fantasma.
  // Se for J, 9 ou Scuttle, o Ponto tem que ser clicável.
  const pointMustBeClickable =
    interactionMode === "effect_9" ||
    interactionMode === "scuttle" ||
    interactionMode === "steal_jack" ||
    interactionMode === "targeting";

  // 3. Aplica ou Remove a classe na mesa
  const pointCards = document.querySelectorAll(".point-card");

  pointCards.forEach((card) => {
    if (pointMustBeClickable) {
      card.classList.remove("pass-through"); // Habilita clique
    } else {
      card.classList.add("pass-through"); // Desabilita clique (corrige bug visual)
    }
  });
} // Update if table cards should be "ghosts" or clickable

function adjustHand(containerDiv = myHandDiv) {
  const cards = containerDiv.getElementsByClassName("card");
  const totalCards = cards.length;

  if (totalCards <= 1) {
    if (totalCards === 1) cards[0].style.marginLeft = "0px";
    return;
  } // If 0 or 1 card, doesn't have to calculate card overlays

  // 1. Discover real avaliable width: Div / Window and uses 90% of it (security margin)
  let containerWidth = containerDiv.clientWidth || window.innerWidth * 0.9;

  const availableSpace = containerWidth - 20; // Substract a fix padding to ensure it doesn't touch the edges

  const cardWidth = 100; // Card fixed width
  const defaultMargin = -40; // Max overlap (when it has few cards)

  // 2. "Accordion" calculation

  // Logic:
  // totalWidth = Card1 +(OtherCardsLeftover * (total - 1))
  // OtherCardsLeftover = CardWidth + NegativeMargin
  // So we want to find the "Negative Margin" so that TotalWidth fits within the AvailableSpace.

  const spaceForOverlaps = availableSpace - cardWidth;
  const numOverlaps = totalCards - 1;
  let visibleSlice = spaceForOverlaps / numOverlaps;
  let newMargin = visibleSlice - cardWidth;

  // 3. Limiters (Locks)

  // Lock 1: Don't let it separate too much (Max -40px)
  if (newMargin > defaultMargin) {
    newMargin = defaultMargin;
  }

  // Lock 2: Don't squeeze too hard to the point of disappearing (Min -80px)
  // If you need to squeeze more than that, the fan will grow a little,
  // but it's better than the cards becoming invisible.
  if (newMargin < -85) {
    newMargin = -85;
  }

  // 4. Application

  for (let i = 0; i < cards.length; i++) {
    if (i === 0) {
      cards[i].style.marginLeft = "0px"; // First card is an anchor: Margin 0
    } else {
      cards[i].style.marginLeft = `${newMargin}px`; // The others recede
    }

    cards[i].style.zIndex = "1"; // Ensures reset of the base index
  }
} // Calculate card visual and relative position in hand

function animateCardFromDeck(cardElement) {
  const deckElement = document.getElementById("deck-pile");

  cardElement.classList.add("flying");

  // 1. Where are the card and the deck on Screen right now?
  const deckRect = deckElement.getBoundingClientRect();
  const cardRect = cardElement.getBoundingClientRect();

  // 2. What's the position diffrence (Delta)? // (Deck - Card) = How far does the card need to go back to be on top of the deck?
  const deltaX = deckRect.left - cardRect.left;
  const deltaY = deckRect.top - cardRect.top;

  // 3. Initial State: "Teleports" to the top of the deck // 'transition: none' ensures it happens immediately.
  cardElement.style.transition = "none";
  cardElement.style.transform = `translate(${deltaX}px, ${deltaY}px) scale(0.5) rotate(180deg)`;

  // 4. Forces the browser to process this position (Reflow)
  void cardElement.offsetHeight;

  // 5. Final State: Gently return to the player hand.
  cardElement.style.transition =
    "transform 0.6s cubic-bezier(0.2, 0.8, 0.2, 1)";
  cardElement.style.transform = "translate(0, 0) scale(1) rotate(0deg)";
  setTimeout(() => {
    cardElement.classList.remove("flying");
    cardElement.style.transform = "";
    cardElement.style.transition = "";
    const myHandDiv = document.getElementById("my-hand");
    if (myHandDiv) adjustHand(myHandDiv);
  }, 10);
} // Deck card buying animation

function createCardVisual(cardData, fireId) {
  const svgIcon = SUITS_SVG[cardData.suit];

  const cardDiv = document.createElement("div");
  cardDiv.classList.add("card");
  cardDiv.dataset.id = fireId; // Card name in Firebase
  cardDiv.dataset.face = cardData.face;

  const isRed = cardData.suit === "hearts" || cardData.suit === "diamonds";
  cardDiv.classList.add(isRed ? "red" : "black");

  cardDiv.innerHTML = `
        <div class="card-content">
            <div class="card-corner top-left">
                <span>${cardData.face}</span>
                <div style="width: 12px;">${svgIcon}</div>
            </div>
            <div class="card-center">
                <div style="width: 40px;">${svgIcon}</div>
            </div>
            <div class="card-corner bottom-right">
                <span>${cardData.face}</span>
                <div style="width: 12px;">${svgIcon}</div>
            </div>
        </div>
    `;

  return cardDiv;
} // Card HTML/CSS visual creation

function calculateTableStats(tableData) {
  if (!tableData) return { points: 0, kings: 0 };

  let currentPoints = 0;
  let kingsCount = 0;

  Object.values(tableData).forEach((card) => {
    const face = String(card.face);

    if (face === "K") {
      kingsCount++;
    } else if (face === "Q" || face === "J" || face === "8") {
      currentPoints += 0;
    } else if (face === "A") {
      currentPoints += 1;
    } else {
      currentPoints += parseInt(face);
    }
  });

  return { points: currentPoints, kings: kingsCount };
} // Returns: {points: X, kings: X} calculates points and kings count

function getWinningGoal(kingsCount) {
  if (kingsCount >= 4) return 5;
  if (kingsCount === 3) return 7;
  if (kingsCount === 2) return 10;
  if (kingsCount === 1) return 14;
  return 21;
} // Returns: Int(X) winning goal based on kings count

function getCardPower(card) {
  let rankVal = 0;
  if (card.face === "A") rankVal = 1;
  else rankVal = parseInt(card.face);

  const suitPower = { spades: 4, hearts: 3, diamonds: 2, clubs: 1 };
  const sVal = suitPower[card.suit] || 0;

  return rankVal * 10 + sVal;
} // Returns Card Score for Scuttles (Calculates based on face and suit)

function createResolveButton() {
  if (document.getElementById("btn-resolve")) return;

  const btn = document.createElement("button");
  btn.id = "btn-resolve";
  btn.innerText = "Permitir Ação";

  // Estilo flutuante no meio da tela
  btn.style.position = "absolute";
  btn.style.top = "60%"; // Um pouco abaixo do centro
  btn.style.left = "50%";
  btn.style.transform = "translate(-50%, -50%)";
  btn.style.zIndex = "2000";
  btn.style.padding = "12px 24px";
  btn.style.backgroundColor = "#28a745"; // Verde
  btn.style.color = "white";
  btn.style.fontWeight = "bold";
  btn.style.border = "2px solid white";
  btn.style.borderRadius = "8px";
  btn.style.cursor = "pointer";
  btn.style.boxShadow = "0 0 15px rgba(0,0,0,0.5)";

  document.body.appendChild(btn);

  btn.addEventListener("click", () => {
    resolvePendingAction(); // Chama a função que criamos no passo 2
  });
} // Creates a button on screen every time an one-off is used (gap to use Counter [2])

function applyOneOffEffect(card, roomData, myPlayerId, targetId = null) {
  const opId = myPlayerId === "player1" ? "player2" : "player1";

  // 1. Safe cloning
  let me = JSON.parse(
    JSON.stringify(roomData[myPlayerId] || { hand: {}, table: {} })
  );
  let op = JSON.parse(
    JSON.stringify(roomData[opId] || { hand: {}, table: {} })
  );

  // 2. Deck Cleanup (Remove nulls)
  let rawDeck = roomData.deck || [];
  let deck = (Array.isArray(rawDeck) ? rawDeck : Object.values(rawDeck)).filter(
    (c) => c !== null && c !== undefined
  );

  let discardPile = Array.isArray(roomData.discardPile)
    ? [...roomData.discardPile]
    : Object.values(roomData.discardPile || {});

  let keepTurn = false; // Keep Turn (7 One-off)

  console.log(`⚡ EFEITO: ${card.face} | Cartas no Deck: ${deck.length}`);

  // This function prevents Javascript from ignoring new cards when saving.
  const ensureHandIsObject = (playerObj) => {
    if (!playerObj.hand) {
      playerObj.hand = {};
    } else if (Array.isArray(playerObj.hand)) {
      playerObj.hand = Object.assign({}, playerObj.hand);
    }
  }; // Converts Array [a, b] to Object { "0": a, "1": b }

  switch (card.face) {
    case "A": // Destroy all points
      const runAce = (p) => {
        const nT = {};
        Object.entries(p.table || {}).forEach(([k, c]) => {
          if (c && ["J", "Q", "K", "8"].includes(c.face)) nT[k] = c;
          else if (c) discardPile.push(c);
        });
        p.table = nT;
      };

      runAce(me);
      runAce(op);

      break;

    case "2": // Destroy 1 Permanent (J, Q, K or 8)
      if (targetId) {
        const processDestruction = (currentTable, currentTableName) => {
          // tableName: 'me' or 'op'
          if (currentTable && currentTable[targetId]) {
            const target = currentTable[targetId];

            if (["J", "Q", "K", "8"].includes(target.face)) {
              if (target.face === "J" && target.stealing) {
                const stolenId = target.stealing;

                if (currentTable[stolenId]) {
                  // 1. Finds the stolen card
                  const stolenCard = currentTable[stolenId];

                  // 2. Look for other Jacks on the table that also holds this card
                  let remainingJacks = [];
                  Object.entries(currentTable).forEach(([k, c]) => {
                    if (
                      k !== targetId &&
                      c.face === "J" &&
                      c.stealing === stolenId
                    ) {
                      remainingJacks.push({ key: k, ...c });
                    }
                  });

                  // 3. Defines who will recieve the card back
                  let newOwnerId = null;

                  if (remainingJacks.length > 0) {
                    // SCENARIO A: There's still a Jack in the pile!
                    // The owner of the most recent Jack (highest key/timestamp) wins possession.
                    remainingJacks.sort((a, b) => (a.key > b.key ? 1 : -1));
                    const topJack = remainingJacks[remainingJacks.length - 1];

                    newOwnerId = topJack.owner; // The one who played the last Jack
                    console.log(
                      `Valete destruído. Posse volta para o dono do Valete anterior: ${newOwnerId}`
                    );
                  } else {
                    // SCENARIO B: No Jacks remain. // Return to the Original Owner of the score card.
                    newOwnerId = stolenCard.originalOwner;
                    console.log(
                      `Último Valete destruído. Posse volta para dono original: ${newOwnerId}`
                    );
                  }

                  // 4. Execute the Transfer (If the owner has changed)
                  // Se o novo dono for diferente do dono da mesa atual, movemos tudo.
                  const currentOwnerId =
                    currentTableName === "me" ? myPlayerId : opId;

                  if (newOwnerId && newOwnerId !== currentOwnerId) {
                    let destTable =
                      newOwnerId === myPlayerId ? me.table : op.table;
                    if (!destTable) destTable = {};

                    // A. Moves point cards
                    destTable[stolenId] = stolenCard;
                    delete currentTable[stolenId];

                    // B. Moves the Jack pile too
                    remainingJacks.forEach((jack) => {
                      destTable[jack.key] = jack; // Move o objeto
                      delete currentTable[jack.key]; // Apaga da mesa antiga
                    });

                    // Updates the reference of the destiny table on the main object
                    if (newOwnerId === myPlayerId) me.table = destTable;
                    else op.table = destTable;
                  }
                } // Checks if the stolen card (Point) is on this same table.
              } // Jacks logic

              discardPile.push(target); // Destroyed Jack goes to discard
              delete currentTable[targetId]; // Deletes Jack from the table
            }
          }
        }; // Function to process the destruction at the correct table

        // Verifies where is the target and runs the logic
        if (op.table && op.table[targetId]) processDestruction(op.table, "op");
        else if (me.table && me.table[targetId])
          processDestruction(me.table, "me");
      }

      break;

    // 3 / 4 are in the main game logic (needs modals and more complex rules to play)

    case "5": // Draw 2 cards
      ensureHandIsObject(me);

      const amount = Math.min(deck.length, 2);
      const drawn5 = deck.splice(0, amount);

      drawn5.forEach((c, i) => {
        if (c) {
          const newKey = `d5_${Date.now()}_${i}`; // Uses Date.now() + index to ensure unique key
          me.hand[newKey] = c;
          // console.log(`5 comprou: ${c.face} (Chave: ${newKey})`); // Debugging
        }
      });

      break;

    case "6": // Destroy all Permanents (J, Q, K, 8)
      const runSix = (p, pName) => {
        const nT = {};

        // 1. Sweep: Destroys figures and returns stolen cards.
        Object.entries(p.table || {}).forEach(([k, c]) => {
          if (c && ["J", "Q", "K", "8"].includes(c.face)) {
            discardPile.push(c); // Permanents -> Discard
          } else if (c) {
            nT[k] = c; // Point -> Keep on the table (for now)
          }
          // If any Jack was destroyed. The card he was holding remains on the table (for now).
        });

        // 2. Ownership Verification (Correction Step)
        // Now 'nT' only has point cards. We need to see if they should stay here.
        // If a card has a different 'originalOwner' than the current player ('p'),
        // And there are no more Jacks on the table protecting it (the 6 killed them all),
        // It should return to its original owner.

        const finalTable = {};

        Object.entries(nT).forEach(([k, c]) => {
          // If the card has an original owner AND that owner is NOT me (it was stolen here)
          if (c.originalOwner && c.originalOwner !== pName) {
            // pName must be 'player1' or 'player2'
            console.log(
              `Carta ${c.face} libertada! Voltando para ${c.originalOwner}`
            );

            if (c.originalOwner === myPlayerId) {
              // Returns to the table of the original owner
              me.table[k] = c;
            } else {
              // Does not add to 'finalTable' (remove from this table)
              op.table[k] = c;
            }
          } else {
            // The card is mine, or I am the original owner.It stays here.
            finalTable[k] = c;
          }
        });

        p.table = finalTable;
      };

      // The logic works both ways // We need to identify who is who in the variables 'me' and 'op'.
      const meId = myPlayerId;
      const opId = myPlayerId === "player1" ? "player2" : "player1";

      runSix(me, meId);
      runSix(op, opId);

      break;

    case "7": // Draw 1 card then play again
      ensureHandIsObject(me);

      if (deck.length > 0) {
        const c7 = deck.pop();
        if (c7) {
          const newKey = `d7_${Date.now()}`;
          me.hand[newKey] = c7;
          // console.log(`7 comprou: ${c7.face} (Chave: ${newKey})`); // Debug
        }
      }

      keepTurn = true;

      break;

    case "9": // "Retreat" a card on table to its owner's hand
      if (targetId) {
        const processNine = (targetTable, targetHand) => {
          const target = targetTable[targetId];

          if (target.face === "J" && target.stealing) {
            const stolenId = target.stealing;
            if (targetTable[stolenId]) {
              const stolenCard = targetTable[stolenId];
              const originalOwner = stolenCard.originalOwner;

              // Jack -> Thief's hand
              // Point -> Original owner's table

              delete stolenCard.originalOwner;
              delete stolenCard.stolenBy;

              if (originalOwner === myPlayerId) me.table[stolenId] = stolenCard;
              else op.table[stolenId] = stolenCard;

              // Removes point from the thief's table
              delete targetTable[stolenId];
            }
          } // Jock's logic

          delete targetTable[targetId]; // Removes target
          targetHand[`ret9_${Date.now()}`] = target; // Put target on the owner's hand
        }; // Auxiliary function to process returns.

        if (op.table && op.table[targetId]) {
          // If I'm returning opponent's card
          if (!op.hand || Array.isArray(op.hand))
            op.hand = Object.assign({}, op.hand || {});
          processNine(op.table, op.hand);
        } else if (me.table && me.table[targetId]) {
          // If I'm returning my card (? idk why would someone do it)
          if (!me.hand || Array.isArray(me.hand))
            me.hand = Object.assign({}, me.hand || {});
          processNine(me.table, me.hand);
        }
      }
      break;
  } // Main One-off Switch

  return {
    player1: myPlayerId === "player1" ? me : op,
    player2: myPlayerId === "player2" ? me : op,
    deck: deck,
    discardPile: discardPile,
    keepTurn: keepTurn,
  };
} // Main One-off effects logic function (A, 2, 5, 6, 7, 9)

function updateTargetVisuals() {
  // 1. Delete everything first
  document.querySelectorAll(".target-possible").forEach((el) => {
    el.classList.remove("target-possible");
  });

  // 2. It only lights up if we are in "Target Mode".
  if (state.waitingForTarget) {
    const opCards = document.querySelectorAll("#op-pts .table-card");
    opCards.forEach((card) => {
      card.classList.add("target-possible");
    });

    const discardSlot = document.querySelector(".discard .card-slot");
    if (discardSlot) discardSlot.style.borderColor = "transparent";
  }
} // Target mode card visual

function updateStatusMessage(status, turn, myPlayerId, pendingAction) {
  if (status === "waiting") {
    statusMsg.innerText = "Aguardando oponente...";
    statusMsg.style.color = "#ccc";
  } else if (status === "ready") {
    // Turn Logic
    if (turn === myPlayerId) {
      // Your Turn
      statusMsg.innerText = "Your turn to play!";
      statusMsg.style.color = "#4ff";
      statusMsg.style.fontWeight = "bold";

      // Lighten your hand / Darken your opponent's hand
      myHandDiv.style.opacity = "1";
      opHandDiv.style.opacity = "0.5";
    } else {
      // Opponent's Turn
      statusMsg.innerText = "Opponent's turn...";
      statusMsg.style.color = "#aaa";

      // Darken your hand / Lighten your opponent's hand
      myHandDiv.style.opacity = "0.7";
      opHandDiv.style.opacity = "1";
    }
  } else if (status === "counter_opportunity") {
    const pending = pendingAction;

    // If there is an outstanding issue and I am NOT the one who played it (I am the target)
    if (pending && pending.source !== myPlayerId) {
      statusMsg.innerText = "Opponent played an one-off! Allow it?";
      statusMsg.style.color = "#ff9900";

      // TODO: Add glowing Counters here (2's)

      createResolveButton(); // Shows the Allow Button
    } else {
      // If there is an outstanding issue and I AM the one who played it (Opponent is the target)
      statusMsg.innerText = "Waiting for opponent's answer...";
      statusMsg.style.color = "#ccc";
    }
  }
} // Status bar message logic (Turns / Counter)

function convertArrayToHandObject(cardArray) {
  const handObj = {};
  cardArray.forEach((card, index) => {
    // Creates an unique key: "init_" + timestamp + index
    const uniqueKey = `init_${Date.now()}_${index}`;
    handObj[uniqueKey] = card;
  });
  return handObj;
} // Converts an array to an object

function openGameOverModal(iWon, p1Data, p2Data, myId) {
  const modal = document.getElementById("game-over-modal");
  if (!modal) return;

  const msgElement = document.getElementById("modal-message");
  const myWinsEl = document.getElementById("my-wins");
  const opWinsEl = document.getElementById("op-wins");

  modal.classList.remove("hidden");

  // Victory/Defeat text
  if (iWon) {
    msgElement.innerText = "🏆 VICTORY! 🏆";
    msgElement.className = "win-text";
  } else {
    msgElement.innerText = "💀 DEFEAT... 💀";
    msgElement.className = "lose-text";
  }

  // Scoreboard
  if (myId === "player1") {
    myWinsEl.innerText = p1Data.wins || 0;
    opWinsEl.innerText = p2Data.wins || 0;
  } else {
    myWinsEl.innerText = p2Data.wins || 0;
    opWinsEl.innerText = p1Data.wins || 0;
  }

  // Restart Button Injection
  // Verifica se o botão já existe para não criar duplicado
  let restartBtn = document.getElementById("btn-restart-game");

  if (!restartBtn) {
    // Create the button dynamically.
    restartBtn = document.createElement("button");
    restartBtn.id = "btn-restart-game";
    restartBtn.innerText = "Jogar Novamente";
    restartBtn.className = "restart-btn"; // CSS Class

    // Adds the event
    restartBtn.onclick = restartGame;

    // Appends the button to the end of the modal
    const modalContent = modal.querySelector(".modal-content");
    if (modalContent) modalContent.appendChild(restartBtn);
  }
} // Shows the game over modal ( Victory / Defeat )

function openDiscardModal(mode, roomData = null) {
  const modal = document.getElementById("discard-modal");
  const grid = document.getElementById("discard-grid");
  const instruction = document.getElementById("modal-instruction");

  modal.classList.remove("hidden");
  grid.innerHTML = ""; // Clear old cards

  // Retrieve the discard (safe array) // If roomData is null (local), we try to retrieve it from the global state if it exists, or pass it as an argument.
  let discardList = [];
  if (roomData) {
    discardList = Array.isArray(roomData.discardPile)
      ? roomData.discardPile
      : Object.values(roomData.discardPile || {});
  } else {
    // Fallback (Try to retrieve it from some global variable or request a refresh.)
    console.error("Dados da sala não fornecidos para o modal.");
    return;
  }

  // Filter nulls
  discardList = discardList.filter((c) => c !== null && c !== undefined);

  if (mode === "pick") {
    instruction.innerText = "Pick a card from the discard pile!";
    instruction.style.color = "#00ff00";
  } else {
    instruction.innerText = "Viewing only. Click outside to close.";
    instruction.style.color = "#ccc";
  }

  // Render the cards
  discardList.forEach((card, index) => {
    const cardDiv = createCardVisual(card, `modal-card-${index}`); // Create cards visual elements (simplified)

    cardDiv.classList.remove("flying");
    cardDiv.style.cursor = "pointer";
    cardDiv.style.position = "relative"; // Resets position (because in the grid it's relative)
    cardDiv.style.transform = "scale(0.9)";

    cardDiv.addEventListener("click", () => {
      if (mode === "pick") {
        executeFishMove(index, card, roomData);
        modal.classList.add("hidden");
      }
    }); // Discard Pile onClick()

    grid.appendChild(cardDiv);
  });

  // Close button
  document.getElementById("close-modal-btn").onclick = () => {
    modal.classList.add("hidden");
  };
} // Shows the discard modal ( 3 One-off / Preview )

// --- 4. EVENT LISTENERS ---

btnEnter.addEventListener("click", async () => {
  const name = inputName.value.trim();
  const room = inputRoom.value.trim();

  if (!name || !room) {
    alert("Please fill name and room inputs!");
    return;
  }

  const success = await joinRoom(room, name);

  if (success) {
    loginScreen.classList.add("hidden");
    gameScreen.classList.remove("hidden");

    setTimeout(() => {
      adjustHand();
    }, 50);
  }
}); // Enter Room Button

deckElement.addEventListener("click", async () => {
  if (!state.currentRoomId || !state.myPlayerId) return;
  if (deckElement.classList.contains("empty")) return;

  const cardsInHand = document.querySelectorAll("#my-hand .card").length;

  if (cardsInHand >= MAX_HAND_SIZE) {
    alert(
      `Your hand is full! You have ${cardsInHand} cards and the limit is ${MAX_HAND_SIZE}!`
    );

    document.getElementById("my-hand").classList.add("shake");
    setTimeout(
      () => document.getElementById("my-hand").classList.remove("shake"),
      500
    );

    return;
  }

  // We use runTransaction() to prevent two people from clicking at the same time and picking the same card.
  const roomRef = ref(db, `rooms/${state.currentRoomId}`);
  console.log(`roomRef: ${roomRef}`);

  try {
    await runTransaction(roomRef, (currentData) => {
      if (!currentData) return; // Room doesn't exist

      // 1. Validations
      if (currentData.turn !== state.myPlayerId) return;

      if (!currentData.deck || currentData.deck.length === 0) {
        currentData.turn =
          state.myPlayerId === "player1" ? "player2" : "player1";
        console.log("Empty deck, passed your turn!");
        return;
      }

      // 2. Gets the deck and the hand
      const deck = currentData.deck;
      const myHand = currentData[state.myPlayerId].hand || {};
      const serverHandSize = Object.keys(myHand).length;
      if (serverHandSize >= MAX_HAND_SIZE) return;

      // 3. Draws the card
      const cardDrawn = deck.pop();

      // Generates a unique ID for the card in hand (using timestamp to ensure order).
      const newCardKey = `card_${Date.now()}`;
      myHand[newCardKey] = cardDrawn;

      // 4. Saves the changes to the local transaction state.
      currentData.deck = deck;
      currentData[state.myPlayerId].hand = myHand;

      // Passes the turn
      currentData.turn = state.myPlayerId === "player1" ? "player2" : "player1";

      return currentData; // Send back to the database
    });

    console.log("Card drawn successfully!");
  } catch (e) {
    console.error("Error in purchase transaction:", e);
  }
}); // Enter Room Button

document.addEventListener("DOMContentLoaded", () => {
  const checkInputs = () => {
    const name = inputName.value.trim();
    const room = inputRoom.value.trim();

    const isValid = name.length >= 3 && room.length > 0; // Valid the name and room length
    btnEnter.disabled = !isValid;
  };

  inputName.addEventListener("input", checkInputs);
  inputRoom.addEventListener("input", checkInputs);

  checkInputs();

  inputRoom.addEventListener("keypress", (e) => {
    if (e.key === "Enter" && !btnEnter.disabled) {
      btnEnter.click();
    }
  }); // Allow "Enter" on the keyboard to enter room.
}); // Function that checks the name and room inputs

myPointsZone.addEventListener("click", () => {
  attemptMove("play_point");
}); // Click on your table to attemptMove()

discardZone.addEventListener("click", async () => {
  // Verifies if the player has the selected card in hand.
  const selected = document.querySelector("#my-hand .card.selected");

  // SCENARIO A: View Discard Pile (No card selected)
  if (!selected) {
    console.log("Viewing discard pile...");

    if (!state.currentRoomId) return;

    // It searches for the most recent data to ensure that the discard management is up-to-date.
    try {
      const snapshot = await get(ref(db, `rooms/${state.currentRoomId}`));
      const roomData = snapshot.val();

      openDiscardModal("view", roomData); // Discard Modal (View Mode)
    } catch (error) {
      console.error("Error while searching discard:", error);
    }
  }
  // SCENARIO B: Play Effect (One-off with selected card)
  else {
    attemptMove("play_effect");
  }
}); // Click on the discard pile to one-off / view discard pile

// --- GAMEPLAY FUNCTIONS ---

async function attemptMove(actionType, targetId = null) {
  console.log("Trying to perform:", actionType);

  // 1. Basic Security Validation
  if (!state.currentRoomId || !state.myPlayerId) {
    alert("Connection error. Reload the page!");
    return;
  }

  // 2. Verifica se tem carta selecionada (UI)
  const selectedElement = document.querySelector(".hand .card.selected");
  if (!selectedElement) {
    alert("Select a card from your hand first!");
    return;
  }

  const myCardId = selectedElement.dataset.id;
  const face = selectedElement.dataset.face; // Gets the face value (A, 4, 9, etc)

  // 3. Reading the state of the room
  const roomRef = ref(db, `rooms/${state.currentRoomId}`);
  let roomData = null;

  try {
    const snapshot = await get(roomRef);
    roomData = snapshot.val();
  } catch (e) {
    console.error("Error reading room:", e);
    return;
  }

  if (!roomData) return; // If no room data, return

  // Verifies turn and game state
  const isCounterMoment = roomData.status === "counter_opportunity";
  const isMyTurn = roomData.turn === state.myPlayerId;
  const isCounterPlay = face === "2" && isCounterMoment;

  if (!isMyTurn && !isCounterPlay) {
    alert("It isn't your turn!");
    return;
  }

  // 3.5 INTERCEPTION: COUNTER // If it's Counter moment and I played a 2, execute the cancel IMMEDIATELY.
  if (isCounterPlay) {
    console.log("Counter detected! Cancelling...");
    await executeCounterMove(myCardId, roomData);
    return; // Stop here. Does not proceed to targeting or executeMoveOnFirebase.
  }

  // 4. TARGETING LOGIC ("AIM MODE" [ 2 / 9 ]) ---
  if (actionType === "play_effect") {
    if (["2", "9", "J"].includes(face) && !targetId) {
      if (!isCounterMoment) {
        console.log(`Starting aim mode for ${face}...`);
        state.waitingForTarget = myCardId;
        updateTargetVisuals();

        const statusMsg = document.getElementById("status-msg");
        if (statusMsg) {
          statusMsg.innerText = "Click the card to steal it!";
          statusMsg.style.color = "#ff9900";
        }
        return;
      }
    }
  }

  // 5. SCUTTLE VALIDATIONS (ATTACKING)
  if (actionType === "scuttle") {
    const opId = state.myPlayerId === "player1" ? "player2" : "player1";
    const opTable = roomData[opId].table || {};
    const targetCard = opTable[targetId];

    if (!targetCard) {
      console.error("Target does not exist anymore!");
      return;
    }

    const myCard = roomData[state.myPlayerId].hand[myCardId];
    if (!myCard) return;

    const myPower = getCardPower(myCard);
    const targetPower = getCardPower(targetCard);

    if (myPower === 0 || targetPower === 0) {
      alert("You can't use Permanents in Scuttles!");
      return;
    }
    if (myPower <= targetPower) {
      alert("Your card is too weak for that attack!");
      selectedElement.classList.add("shake");
      setTimeout(() => selectedElement.classList.remove("shake"), 500);
      return;
    }
  }

  // 5.5 [2] ONE-OFF VALIDATION (Only destroys Permanents) ---
  if (actionType === "play_effect" && face === "2" && targetId) {
    const opId = state.myPlayerId === "player1" ? "player2" : "player1";
    const opTable = roomData[opId].table || {};
    const myTable = roomData[state.myPlayerId].table || {};
    const targetCard = opTable[targetId] || myTable[targetId];

    if (targetCard) {
      const isPermanent = ["J", "Q", "K", "8"].includes(targetCard.face);
      if (!isPermanent) {
        alert("2 can only destroy Permanents (J, Q, K, 8)!");
        selectedElement.classList.remove("selected");
        state.waitingForTarget = null;
        updateTargetVisuals();
        return;
      }
    }
  }

  // 5.6 JACK SPECIFIC VALIDATION [J]
  if (actionType === "play_jack" && targetId) {
    const opId = state.myPlayerId === "player1" ? "player2" : "player1";
    const opTable = roomData[opId].table || {};

    const hasQueen = Object.values(opTable).some((card) => card.face === "Q");

    if (hasQueen) {
      alert(
        "A Rainha protege o oponente! Você não pode roubar cartas enquanto ela estiver na mesa."
      );

      // Cancela a seleção visual
      selectedElement.classList.remove("selected");
      state.waitingForTarget = null;
      updateTargetVisuals();
      return; // PARA TUDO
    }

    // O alvo tem que estar na mesa do oponente
    const targetCard = opTable[targetId];

    if (!targetCard) {
      alert("Alvo inválido!");
      return;
    }

    if (targetCard.face === "J" && targetCard.stealing) {
      console.log(
        "Alvo era um Valete! Redirecionando para a carta roubada:",
        targetCard.stealing
      );

      // Atualiza o ID do alvo para a carta de baixo (o Ponto)
      targetId = targetCard.stealing;
      targetCard = opTable[targetId]; // Atualiza os dados da carta alvo

      // Segurança extra: E se a carta de baixo sumiu?
      if (!targetCard) {
        alert("Erro: A carta roubada não foi encontrada na mesa.");
        return;
      }
    }

    // Regra: Valete só rouba PONTOS (A, 2-10).
    // Figuras (K, Q, J) e 8 (Óculos) não podem ser roubados diretamente.
    const isPointCard = !["K", "Q", "J", "8"].includes(targetCard.face);

    if (!isPointCard) {
      alert("O Valete só pode roubar cartas de Ponto (A-10)!");
      // Reset visual
      selectedElement.classList.remove("selected");
      state.waitingForTarget = null;
      updateTargetVisuals();
      return;
    }
  }

  // --- 6. EXECUÇÃO ---
  await executeMoveOnFirebase(actionType, myCardId, roomData, targetId);
}

async function executeMoveOnFirebase(
  actionType,
  cardId,
  roomData,
  targetId = null
) {
  console.log("Executando no Firebase...", actionType, cardId);

  // Caminhos no Banco de Dados
  const myHandPath = `rooms/${state.currentRoomId}/${state.myPlayerId}/hand`;
  const myTablePath = `rooms/${state.currentRoomId}/${state.myPlayerId}/table`;
  const discardPath = `rooms/${state.currentRoomId}/discardPile`;
  const turnPath = `rooms/${state.currentRoomId}/turn`;

  // Resgata os dados da carta da mão
  const myHand = roomData[state.myPlayerId].hand;

  const cardToPlay = myHand[cardId];

  if (!cardToPlay) {
    console.error(
      `Erro: Carta não encontrada na mão. ID: ${cardId} CTP: ${cardToPlay}`
    );
    return;
  }

  const updates = {};
  const opId = state.myPlayerId === "player1" ? "player2" : "player1";

  // --- A. JOGAR PONTO (Play Point) ---
  if (actionType === "play_point") {
    const newTableKey = push(ref(db, myTablePath)).key;
    updates[`${myTablePath}/${newTableKey}`] = cardToPlay;
    updates[`${myHandPath}/${cardId}`] = null;

    // Passa a vez
    updates[turnPath] = opId;
  }

  // --- B. SCUTTLE (Ataque) ---
  else if (actionType === "scuttle") {
    // Verifica se temos o ID do alvo
    if (!targetId) {
      console.error("Erro: Scuttle sem alvo definido.");
      return;
    }

    const opTablePath = `rooms/${state.currentRoomId}/${opId}/table`;

    // Precisamos dos dados da carta do inimigo para salvar no lixo
    // (A roomData pode estar levemente desatualizada, mas para o lixo serve)
    const targetCard = roomData[opId].table[targetId];

    // 1. Minha carta vai pro lixo
    const key1 = push(ref(db, discardPath)).key;
    updates[`${discardPath}/${key1}`] = cardToPlay;
    updates[`${myHandPath}/${cardId}`] = null;

    // 2. Carta do inimigo vai pro lixo
    const key2 = push(ref(db, discardPath)).key;
    updates[`${discardPath}/${key2}`] = targetCard;
    updates[`${opTablePath}/${targetId}`] = null; // Apaga da mesa dele

    // 3. Passa a vez
    updates[turnPath] = opId;
  }

  // --- C. JOGAR EFEITO (Play Effect - Futuro) ---
  else if (actionType === "play_effect") {
    // Figuras não jogam efeito
    if (["K", "Q", "J"].includes(cardToPlay.face)) {
      alert("Figuras não têm efeitos One-Off!");
      return;
    }

    // 1. Remove da mão e Joga no Lixo
    const newDiscardKey = push(ref(db, discardPath)).key;

    // Removemos da mão manualmente aqui para garantir
    // (A função attemptMove já validou, mas aqui efetivamos no banco)
    delete roomData[state.myPlayerId].hand[cardId];
    updates[`${myHandPath}/${cardId}`] = null;

    updates[`${discardPath}/${newDiscardKey}`] = cardToPlay;

    // 2. Proteção da Rainha (Opcional, se quiser implementar depois)
    // Por enquanto, vamos direto para a pausa (Regra Counter)

    console.log(`Jogou ${cardToPlay.face}! Pausando...`);

    // 3. Define Ação Pendente e TRAVA o jogo
    updates[`rooms/${state.currentRoomId}/pendingAction`] = {
      type: `effect_${cardToPlay.face}`,
      source: state.myPlayerId,
      targetId: targetId || null,
    };

    updates[`rooms/${state.currentRoomId}/status`] = "counter_opportunity";

    // OBS: A vez NÃO passa aqui. Passa no resolvePendingAction.
  }

  // --- D. JOGAR VALETE (Roubar Ponto) ---
  else if (actionType === "play_jack") {
    const opTablePath = `rooms/${state.currentRoomId}/${opId}/table`;
    const myTablePath = `rooms/${state.currentRoomId}/${state.myPlayerId}/table`; // Caminho explícito

    // --- VERIFICAÇÃO DE SEGURANÇA (RAINHA) ---
    const opTable = roomData[opId].table || {};
    const hasQueen = Object.values(opTable).some((c) => c.face === "Q");

    if (hasQueen) {
      console.error("Tentativa de roubo bloqueada pela Rainha!");
      return; // Cancela a jogada silenciosamente no servidor
    }

    // 1. Identifica a carta alvo
    const targetCard = roomData[opId].table[targetId];

    if (!targetCard) {
      console.error("Alvo do Valete sumiu!");
      return;
    }

    // 2. Define o Dono Original (Se já não tiver, é quem estava com ela agora/antes do primeiro roubo)
    // Se a carta já tem 'originalOwner', mantemos. Se não, definimos o opId.
    const originalOwner = targetCard.originalOwner || opId;

    // 3. TRANSFERÊNCIA DA CARTA ALVO
    // Remove do Oponente
    updates[`${opTablePath}/${targetId}`] = null;

    // Adiciona na Minha Mesa (mantendo metadados antigos)
    updates[`${myTablePath}/${targetId}`] = {
      ...targetCard,
      originalOwner: originalOwner,
      // Não precisamos mais do 'stolenBy' único, pois vamos buscar por referência,
      // mas podemos atualizar para o ID do NOVO Valete para facilitar o render.
    };

    // 4. TRANSFERÊNCIA DOS VALETES ANTERIORES (A CORREÇÃO)
    // Procuramos na mesa do oponente qualquer carta que esteja roubando ESTE alvo
    if (roomData[opId].table) {
      Object.entries(roomData[opId].table).forEach(([key, card]) => {
        if (card.stealing === targetId) {
          // É um Valete antigo preso nessa carta!
          // Remove do oponente
          updates[`${opTablePath}/${key}`] = null;
          // Move para minha mesa (ele continua roubando o mesmo ID de alvo)
          updates[`${myTablePath}/${key}`] = card;
        }
      });
    }

    // 5. JOGA O MEU NOVO VALETE
    // 5. JOGA O MEU NOVO VALETE
    const newJackKey = push(ref(db, myTablePath)).key;
    const newJackData = {
      ...cardToPlay,
      stealing: targetId,
      rootSteal: true,
      owner: state.myPlayerId,
    };

    updates[`${myTablePath}/${newJackKey}`] = newJackData;

    updates[`${myTablePath}/${newJackKey}`] = newJackData;
    updates[`${myHandPath}/${cardId}`] = null;

    // 6. Passa a vez
    updates[turnPath] = opId;
    updates[`rooms/${state.currentRoomId}/lastAction`] =
      `Roubou um ${targetCard.face} com Valete!`;
  }

  // 4. Passa a vez
  updates[turnPath] = opId;
  // Envia tudo para o Firebase
  try {
    await update(ref(db), updates);
    console.log("Sucesso! Jogada registrada.");
    document
      .querySelectorAll(".selected")
      .forEach((el) => el.classList.remove("selected"));
  } catch (error) {
    console.error("Erro ao atualizar Firebase:", error);
  }
}

async function resolvePendingAction() {
  console.log("🛠️ RESOLVENDO AÇÃO...");

  if (!state.currentRoomId) return;

  const roomRef = ref(db, `rooms/${state.currentRoomId}`);
  const snapshot = await get(roomRef);
  const roomData = snapshot.val();
  const pending = roomData.pendingAction;

  if (!pending) return;

  // Identifica carta e parametros
  const face = pending.type.split("_")[1];
  const cardSimulated = { face: face };

  // CASO ESPECIAL DO 3 (Inicia modo pesca)
  if (face === "3") {
    console.log("Efeito do 3: Iniciando modo de pesca.");

    const updates = {};
    // Muda status para esperar a pesca
    updates[`rooms/${state.currentRoomId}/status`] = "waiting_fishing_3";

    // Mantém a pendência ativa para sabermos quem está pescando
    updates[`rooms/${state.currentRoomId}/pendingAction`] = {
      type: "resolving_3",
      source: pending.source,
    };

    updates[`rooms/${state.currentRoomId}/lastAction`] =
      "Oponente está escolhendo uma carta do lixo...";

    await update(ref(db), updates);

    // Remove botão e sai
    const btn = document.getElementById("btn-resolve");
    if (btn) btn.remove();
    return;
  }

  // --- CASO ESPECIAL DO 4 (Inicia modo descarte) ---
  if (face === "4") {
    const victimId = pending.source === "player1" ? "player2" : "player1";
    const updates = {};
    updates[`rooms/${state.currentRoomId}/status`] = "waiting_discard_4";
    updates[`rooms/${state.currentRoomId}/pendingAction`] = {
      type: "resolving_4",
      source: pending.source,
      victim: victimId,
      discardCount: 0,
    };
    updates[`rooms/${state.currentRoomId}/lastAction`] =
      "Oponente deve descartar 2 cartas!";
    await update(ref(db), updates);

    const btn = document.getElementById("btn-resolve");
    if (btn) btn.remove();
    return;
  }

  // --- TODOS OS OUTROS (5, 7, A, 2, 9...) ---

  // Chama a função mágica
  const result = applyOneOffEffect(
    cardSimulated,
    roomData,
    pending.source,
    pending.targetId
  );

  const updates = {};

  // Salva o novo estado do mundo
  updates[`rooms/${state.currentRoomId}/player1`] = result.player1;
  updates[`rooms/${state.currentRoomId}/player2`] = result.player2;
  updates[`rooms/${state.currentRoomId}/deck`] = result.deck;
  updates[`rooms/${state.currentRoomId}/discardPile`] = result.discardPile;

  // Limpa pendência
  updates[`rooms/${state.currentRoomId}/pendingAction`] = null;
  updates[`rooms/${state.currentRoomId}/status`] = "ready";

  // Lógica de Turno (O 7 mantém, o resto passa)
  if (result.keepTurn) {
    updates[`rooms/${state.currentRoomId}/turn`] = pending.source;
    updates[`rooms/${state.currentRoomId}/lastAction`] =
      `Efeito do ${face}. Turno Mantido!`;
  } else {
    const nextPlayer = pending.source === "player1" ? "player2" : "player1";
    updates[`rooms/${state.currentRoomId}/turn`] = nextPlayer;
    updates[`rooms/${state.currentRoomId}/lastAction`] =
      `Efeito do ${face} resolvido.`;
  }

  try {
    await update(ref(db), updates);
    console.log("✅ Resolvido!");

    const btn = document.getElementById("btn-resolve");
    if (btn) btn.remove();
  } catch (error) {
    console.error("❌ Erro:", error);
  }
}

async function executeCounterMove(cardId, roomData) {
  console.log("⛔ COUNTER! Jogando o 2 para cancelar...");

  const updates = {};
  const myHandPath = `rooms/${state.currentRoomId}/${state.myPlayerId}/hand`;
  const discardPath = `rooms/${state.currentRoomId}/discardPile`;

  // 1. Acesso Seguro à Carta (Tratando Mão como Objeto)
  const hand = roomData[state.myPlayerId].hand || {};
  const cardToPlay = hand[cardId];

  if (!cardToPlay) {
    console.error("Erro: Carta Counter (2) não encontrada na mão.");
    return;
  }

  // 2. Joga o 2 no lixo
  const key2 = push(ref(db, discardPath)).key;
  updates[`${discardPath}/${key2}`] = cardToPlay;

  // 3. Remove o 2 da mão
  updates[`${myHandPath}/${cardId}`] = null;

  // 4. CANCELA A AÇÃO PENDENTE (O efeito do 5/A/etc morre aqui)
  updates[`rooms/${state.currentRoomId}/pendingAction`] = null;

  // 5. Volta o status do jogo ao normal
  updates[`rooms/${state.currentRoomId}/status`] = "ready";

  // 6. Define de quem é a vez
  // Regra: O Oponente gastou o turno tentando jogar o efeito.
  // Você gastou o 2 para anular. Agora a vez é SUA (de quem jogou o Counter).
  updates[`rooms/${state.currentRoomId}/turn`] = state.myPlayerId;

  updates[`rooms/${state.currentRoomId}/lastAction`] =
    "Ação cancelada pelo Counter (2)!";

  try {
    await update(ref(db), updates);

    // Limpeza de UI: Remove o botão de "Permitir" se ele ainda estiver na tela
    const btn = document.getElementById("btn-resolve");
    if (btn) btn.remove();
  } catch (error) {
    console.error("Erro ao executar Counter:", error);
  }
}

async function handleGameOver(winnerId) {
  console.log("Fim de jogo detectado! Vencedor:", winnerId);

  const roomRef = ref(db, `rooms/${state.currentRoomId}`);

  await runTransaction(roomRef, (room) => {
    if (!room) return;
    if (room.status === "game_over") return; // Já foi processado

    // Incrementa vitória
    if (room[winnerId]) {
      room[winnerId].wins = (room[winnerId].wins || 0) + 1;
    }

    // Define status de fim
    room.status = "game_over";
    room.winner = winnerId;

    return room;
  });
}

async function executeFishMove(cardIndex, card, roomData) {
  console.log("Pescando carta:", card.face);

  const updates = {};

  // 1. Prepara a Mão (Garante que é objeto)
  const myHand = roomData[state.myPlayerId].hand || {};
  // Hack para garantir que não vamos perder dados se for array
  const safeHand = Array.isArray(myHand) ? Object.assign({}, myHand) : myHand;

  // Adiciona carta pescada na mão
  const newKey = `fished_${Date.now()}`;
  updates[`rooms/${state.currentRoomId}/${state.myPlayerId}/hand/${newKey}`] =
    card;

  // 2. Remove do Lixo
  // Como o lixo no Firebase geralmente é um array/lista, a melhor forma de remover
  // um item específico pelo índice é reescrever o lixo sem aquele item.
  let discardList = Array.isArray(roomData.discardPile)
    ? [...roomData.discardPile]
    : Object.values(roomData.discardPile || {});
  discardList = discardList.filter((c) => c !== null);

  // Remove a carta escolhida (pelo índice visualizado ou filtro - índice é mais seguro aqui)
  // O modal renderizou discardList[index], então removemos esse index.
  discardList.splice(cardIndex, 1);

  updates[`rooms/${state.currentRoomId}/discardPile`] = discardList;

  // 3. Finaliza Turno e Limpa Status
  updates[`rooms/${state.currentRoomId}/pendingAction`] = null;
  updates[`rooms/${state.currentRoomId}/status`] = "ready";

  // Passa a vez para o inimigo
  const opId = state.myPlayerId === "player1" ? "player2" : "player1";
  updates[`rooms/${state.currentRoomId}/turn`] = opId;
  updates[`rooms/${state.currentRoomId}/lastAction`] =
    `Pescou um ${card.face} do lixo.`;

  await update(ref(db), updates);
}

async function restartGame() {
  if (!state.currentRoomId) return;

  if (!confirm("Tem certeza que deseja reiniciar o jogo?")) return;

  const roomRef = ref(db, `rooms/${state.currentRoomId}`);

  try {
    const snapshot = await get(roomRef);
    const roomData = snapshot.val();

    if (!roomData) return;

    // 1. Cria novo baralho embaralhado
    const fullDeck = shuffleDeck(createFullDeck());

    // 2. Distribui novas mãos (5 cartas para cada - ajuste se necessário)
    // Importante: Usamos splice para tirar do baralho
    const hand1Array = fullDeck.splice(0, 5); // 5 cartas para P1
    const hand2Array = fullDeck.splice(0, 6); // 6 cartas para P2 (Vantagem do 2º jogador no Cuttle)

    // 3. Converte para Objeto (Correção do bug de cartas repetidas/fantasmas)
    const hand1 = convertArrayToHandObject(hand1Array);
    const hand2 = convertArrayToHandObject(hand2Array);

    // 4. Prepara os dados limpos dos jogadores
    // Mantemos o nome, score acumulado e vitórias. Limpamos a mesa e mão.
    const p1Data = {
      ...roomData.player1,
      hand: hand1,
      table: {},
      score: 0,
      // wins: roomData.player1.wins // O Firebase já guarda isso, não precisamos sobrescrever se não quisermos resetar o placar geral
    };

    const p2Data = {
      ...roomData.player2,
      hand: hand2,
      table: {},
      score: 0,
      // wins: roomData.player2.wins
    };

    // 5. Atualiza tudo no Firebase de uma vez
    const updates = {};
    updates[`rooms/${state.currentRoomId}/player1`] = p1Data;
    updates[`rooms/${state.currentRoomId}/player2`] = p2Data;
    updates[`rooms/${state.currentRoomId}/deck`] = fullDeck;
    updates[`rooms/${state.currentRoomId}/discardPile`] = []; // Limpa o lixo

    // Reseta estado do jogo
    updates[`rooms/${state.currentRoomId}/status`] = "ready";
    updates[`rooms/${state.currentRoomId}/turn`] = "player1"; // P1 sempre começa no reset
    updates[`rooms/${state.currentRoomId}/pendingAction`] = null;
    updates[`rooms/${state.currentRoomId}/winner`] = null;
    updates[`rooms/${state.currentRoomId}/lastAction`] =
      "--- JOGO REINICIADO ---";

    await update(ref(db), updates);
    console.log("Jogo reiniciado com sucesso!");
  } catch (error) {
    console.error("Erro ao reiniciar:", error);
  }
}

////// DEBUGGING WITH DEVTOOLS //////

// window.db = db;
// window.ref = ref;
// window.get = get;
// window.state = state;
