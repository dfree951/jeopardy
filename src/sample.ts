import { blankBoard } from "./model";
export function sampleBoard() {
  const board = blankBoard();
  board.title = "Game night";
  const data = [
    [
      "Around the world",
      ["This city is home to the Eiffel Tower.", "Paris"],
      ["This is the largest ocean on Earth.", "The Pacific Ocean"],
      ["The ancient city of Machu Picchu is in this country.", "Peru"],
      ["This river runs through Egypt.", "The Nile"],
      [
        "This country has the most time zones, including its overseas territories.",
        "France",
      ],
    ],
    [
      "Science",
      ["This planet is known as the Red Planet.", "Mars"],
      ["Plants absorb this gas during photosynthesis.", "Carbon dioxide"],
      ["This element has the chemical symbol Au.", "Gold"],
      ["This force keeps the planets in orbit around the Sun.", "Gravity"],
      [
        "This part of a cell contains most of its genetic material.",
        "The nucleus",
      ],
    ],
    [
      "At the movies",
      ["This cowboy toy has a friend named Buzz Lightyear.", "Woody"],
      [
        "This movie features a theme park full of cloned dinosaurs.",
        "Jurassic Park",
      ],
      [
        "In The Wizard of Oz, Dorothy follows a road made of these.",
        "Yellow bricks",
      ],
      [
        "This fictional African nation is the home of Black Panther.",
        "Wakanda",
      ],
      ["This director made Jaws, E.T., and Jurassic Park.", "Steven Spielberg"],
    ],
    [
      "Food & drink",
      ["Guacamole is primarily made from this fruit.", "Avocado"],
      ["This Italian dish is made with layers of pasta.", "Lasagna"],
      ["This spice gives many curries their yellow color.", "Turmeric"],
      ["Traditional hummus is made from these legumes.", "Chickpeas"],
      [
        "This French pastry gets its name from its crescent shape.",
        "Croissant",
      ],
    ],
    [
      "Sports",
      [
        "A soccer team starts a match with this many players on the field.",
        "Eleven",
      ],
      ["This sport uses a puck.", "Ice hockey"],
      ["In tennis, this word means a score of zero.", "Love"],
      ["The Tour de France is a competition in this sport.", "Cycling"],
      [
        "This Olympic event combines swimming, cycling, and running.",
        "Triathlon",
      ],
    ],
    [
      "A little of everything",
      ["There are this many sides on a hexagon.", "Six"],
      ["This instrument has 88 keys on a standard model.", "A piano"],
      ["This author wrote The Hobbit.", "J. R. R. Tolkien"],
      ["The Roman numeral L represents this number.", "Fifty"],
      ["This is the only mammal capable of sustained flight.", "A bat"],
    ],
  ] as const;
  board.categories.forEach((category, i) => {
    category.name = data[i][0];
    category.cards.forEach((card, j) => {
      card.clue = data[i][j + 1][0];
      card.answer = data[i][j + 1][1];
    });
  });
  return board;
}
